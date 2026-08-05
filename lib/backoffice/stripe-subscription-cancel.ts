import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  pendingPlanChange,
  subscription,
  subscriptionEvent,
} from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { canCancelStripeSubscriptionAtPeriodEnd } from "@/lib/backoffice/stripe-subscription-cancel-policy";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";

export type CancelStripeSubscriptionError =
  | "stripe_not_configured"
  | "user_not_found"
  | "no_stripe_subscription"
  | "already_scheduled"
  | "stripe_error";

export type CancelStripeSubscriptionResult =
  | {
      ok: true;
      cancelAt: string | null;
      cancelAtPeriodEnd: true;
    }
  | {
      ok: false;
      error: CancelStripeSubscriptionError;
      message: string;
    };

async function releaseStripeSubscriptionSchedule(
  stripeSubscriptionId: string,
): Promise<void> {
  if (!stripe) return;

  const liveSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const scheduleRef = liveSub.schedule;
  const scheduleId =
    typeof scheduleRef === "string"
      ? scheduleRef
      : scheduleRef && "id" in scheduleRef
        ? scheduleRef.id
        : null;

  if (scheduleId) {
    await stripe.subscriptionSchedules.release(scheduleId);
  }
}

export async function cancelStripeSubscriptionAtPeriodEndWithAudit({
  userId,
  adminEmail,
}: {
  userId: string;
  adminEmail: string;
}): Promise<CancelStripeSubscriptionResult> {
  if (!stripe) {
    return {
      ok: false,
      error: "stripe_not_configured",
      message: "Stripe não está configurado no backoffice.",
    };
  }

  const subscriptions = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId));

  const activeSubscription = pickActiveSubscription(subscriptions);
  if (
    !activeSubscription ||
    !canCancelStripeSubscriptionAtPeriodEnd(activeSubscription)
  ) {
    if (activeSubscription?.cancelAtPeriodEnd) {
      return {
        ok: false,
        error: "already_scheduled",
        message: "Esta assinatura já está marcada para cancelar na expiração.",
      };
    }

    return {
      ok: false,
      error: "no_stripe_subscription",
      message: "Este usuário não possui assinatura Stripe ativa para cancelar.",
    };
  }

  const stripeSubscriptionId = activeSubscription.stripeSubscriptionId;
  if (!stripeSubscriptionId) {
    return {
      ok: false,
      error: "no_stripe_subscription",
      message: "Este usuário não possui assinatura Stripe ativa para cancelar.",
    };
  }

  try {
    await releaseStripeSubscriptionSchedule(stripeSubscriptionId);
    await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro inesperado ao cancelar assinatura no Stripe.";
    return {
      ok: false,
      error: "stripe_error",
      message,
    };
  }

  const now = new Date();
  const cancelAt = activeSubscription.currentPeriodEnd?.toISOString() ?? null;

  await db.transaction(async (tx) => {
    await tx
      .update(subscription)
      .set({
        cancelAtPeriodEnd: true,
        canceledAt: now,
        updatedAt: now,
      })
      .where(eq(subscription.id, activeSubscription.id));

    await tx
      .update(pendingPlanChange)
      .set({
        status: "canceled",
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingPlanChange.userId, userId),
          eq(pendingPlanChange.status, "pending"),
        ),
      );

    await tx.insert(subscriptionEvent).values({
      userId,
      subscriptionId: activeSubscription.id,
      eventType: "canceled",
      fromPlan: activeSubscription.planType,
      metadata: {
        source: "backoffice",
        mode: "cancel_at_period_end",
        adminEmail,
        cancelAt,
      },
    });

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: "cancel_stripe_subscription",
      fieldName: "subscription.cancel_at_period_end",
      oldValue: "false",
      newValue: "true",
      note: cancelAt
        ? `Cancelamento agendado para ${cancelAt}.`
        : "Cancelamento agendado para o fim do período atual.",
    });
  });

  return {
    ok: true,
    cancelAt,
    cancelAtPeriodEnd: true,
  };
}
