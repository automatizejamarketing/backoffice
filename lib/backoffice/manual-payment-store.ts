import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  creditTransaction,
  mercadopagoPaymentLink,
  payment,
  subscription,
  subscriptionEvent,
  user,
  type Subscription,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { stripeBlocksPixRenewal } from "@/lib/backoffice/pix-renewal-policy";
import {
  isManualPaymentPlanType,
  parseManualPaymentDate,
  quoteManualPayment,
  resolveManualPaymentEventType,
} from "@/lib/backoffice/manual-payment";

export type RecordManualPaymentError =
  | "user_not_found"
  | "stripe_active"
  | "duplicate_external_id"
  | "invalid_plan"
  | "invalid_date"
  | "payment_date_in_future";

export type RecordManualPaymentResult =
  | {
      ok: true;
      newExpiration: Date;
      creditsGranted: number;
      paymentId: string;
      subscriptionId: string;
      amountCentavos: number;
    }
  | { ok: false; error: RecordManualPaymentError };

function normalizeExternalId(transactionId: string | null | undefined): string | null {
  const trimmed = transactionId?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function recordManualPaymentForUser({
  userId,
  planType,
  paidOn,
  transactionId,
  adminEmail,
}: {
  userId: string;
  planType: string;
  paidOn: string;
  transactionId?: string | null;
  adminEmail: string;
}): Promise<RecordManualPaymentResult> {
  const externalId = normalizeExternalId(transactionId);
  const paidAt = parseManualPaymentDate(paidOn);
  if (Number.isNaN(paidAt.getTime())) {
    return { ok: false, error: "invalid_date" };
  }

  const [existingUser, subscriptions, pendingLinks, duplicatePayments] =
    await Promise.all([
      db.select().from(user).where(eq(user.id, userId)).limit(1).then((rows) => rows[0] ?? null),
      db.select().from(subscription).where(eq(subscription.userId, userId)),
      db
        .select()
        .from(mercadopagoPaymentLink)
        .where(
          and(
            eq(mercadopagoPaymentLink.userId, userId),
            eq(mercadopagoPaymentLink.status, "pending"),
          ),
        ),
      externalId
        ? db
            .select({ id: payment.id })
            .from(payment)
            .where(eq(payment.externalId, externalId))
            .limit(1)
        : Promise.resolve([]),
    ]);

  if (!existingUser) {
    return { ok: false, error: "user_not_found" };
  }

  if (subscriptions.some(stripeBlocksPixRenewal)) {
    return { ok: false, error: "stripe_active" };
  }

  if (duplicatePayments.length > 0) {
    return { ok: false, error: "duplicate_external_id" };
  }

  if (!isManualPaymentPlanType(planType)) {
    return { ok: false, error: "invalid_plan" };
  }

  const quote = quoteManualPayment({
    planType,
    paidAt,
    currentExpiration: existingUser.expirationDate,
  });
  if (!quote.ok) {
    return quote;
  }

  const planName = PLAN_DEFINITIONS[planType].name;
  const description = externalId
    ? `Pagamento manual — ${planName} (${externalId})`
    : `Pagamento manual — ${planName}`;
  const oldExpirationIso = existingUser.expirationDate?.toISOString() ?? null;
  const now = new Date();

  const persisted = await db.transaction(async (tx) => {
    if (externalId) {
      const [duplicateInTx] = await tx
        .select({ id: payment.id })
        .from(payment)
        .where(eq(payment.externalId, externalId))
        .limit(1);
      if (duplicateInTx) {
        return { kind: "duplicate" as const };
      }
    }

    const [existingBillingSubscription] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.userId, userId),
          inArray(subscription.provider, ["mercadopago", "manual"]),
          eq(subscription.status, "active"),
        ),
      )
      .orderBy(desc(subscription.createdAt))
      .limit(1)
      .for("update");

    let dbSubscription: Subscription;
    if (existingBillingSubscription) {
      const [updated] = await tx
        .update(subscription)
        .set({
          provider: "manual",
          stripeSubscriptionId: null,
          stripePriceId: null,
          planType,
          status: "active",
          currentPeriodStart: paidAt,
          currentPeriodEnd: quote.newExpiration,
          commitmentEndDate: quote.newExpiration,
          commitmentMonths: quote.commitmentMonths,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          updatedAt: now,
        })
        .where(eq(subscription.id, existingBillingSubscription.id))
        .returning();
      if (!updated) {
        throw new Error("Failed to update subscription");
      }
      dbSubscription = updated;
    } else {
      const [created] = await tx
        .insert(subscription)
        .values({
          userId,
          provider: "manual",
          planType,
          status: "active",
          currentPeriodStart: paidAt,
          currentPeriodEnd: quote.newExpiration,
          commitmentEndDate: quote.newExpiration,
          commitmentMonths: quote.commitmentMonths,
          cancelAtPeriodEnd: false,
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create subscription");
      }
      dbSubscription = created;
    }

    const [paymentRow] = await tx
      .insert(payment)
      .values({
        userId,
        subscriptionId: dbSubscription.id,
        provider: "manual",
        externalId,
        amount: quote.amountCentavos,
        grossAmount: quote.amountCentavos,
        netAmount: quote.amountCentavos,
        feeAmount: 0,
        currency: "brl",
        status: "succeeded",
        planType,
        description,
        paidAt,
      })
      .returning({ id: payment.id });

    if (!paymentRow) {
      throw new Error("Failed to create payment");
    }

    await tx
      .update(user)
      .set({ expirationDate: quote.newExpiration })
      .where(eq(user.id, userId));

    const creditRows = await tx.execute(
      sql`UPDATE users SET credits = credits + ${quote.credits} WHERE id = ${userId} RETURNING credits`,
    );
    const creditRowList = creditRows as unknown as { credits: number }[];
    if (creditRowList[0] === undefined) {
      throw new Error("user_not_found");
    }

    await tx.insert(creditTransaction).values({
      userId,
      amount: quote.credits,
      type: "subscription_payment",
      description: `+${quote.credits / 10} imagens (pagamento manual ${planName})`,
      metadata: {
        provider: "manual",
        planType,
        adminEmail,
        ...(externalId ? { transactionId: externalId } : {}),
        paymentId: paymentRow.id,
      },
    });

    const eventType = resolveManualPaymentEventType(
      existingBillingSubscription ?? null,
      planType,
    );
    await tx.insert(subscriptionEvent).values({
      userId,
      subscriptionId: dbSubscription.id,
      eventType,
      fromPlan:
        eventType === "plan_changed"
          ? existingBillingSubscription?.planType
          : undefined,
      toPlan: planType,
      metadata: {
        provider: "manual",
        source: "backoffice",
        adminEmail,
        ...(externalId ? { transactionId: externalId } : {}),
        paymentId: paymentRow.id,
      },
    });

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: "record_manual_payment",
      fieldName: "expiration_date",
      oldValue: oldExpirationIso,
      newValue: quote.newExpiration.toISOString(),
      note: `${description}. +${quote.credits} créditos. ${pendingLinks.length} Pix pendente(s) cancelado(s).`,
    });

    if (pendingLinks.length > 0) {
      await tx
        .update(mercadopagoPaymentLink)
        .set({
          status: "canceled",
          updatedAt: now,
        })
        .where(
          and(
            eq(mercadopagoPaymentLink.userId, userId),
            eq(mercadopagoPaymentLink.status, "pending"),
          ),
        );
    }

    return {
      kind: "ok" as const,
      paymentId: paymentRow.id,
      subscriptionId: dbSubscription.id,
    };
  });

  if (persisted.kind === "duplicate") {
    return { ok: false, error: "duplicate_external_id" };
  }

  return {
    ok: true,
    newExpiration: quote.newExpiration,
    creditsGranted: quote.credits,
    paymentId: persisted.paymentId,
    subscriptionId: persisted.subscriptionId,
    amountCentavos: quote.amountCentavos,
  };
}
