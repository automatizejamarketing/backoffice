import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  pendingPlanChange,
  subscription,
  subscriptionEvent,
  mercadopagoPaymentLink,
  user,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { updateUserExpirationWithAudit } from "@/lib/backoffice/user-field-updates";
import {
  recoverFailedPaymentWithAudit,
  type RecoveryError,
  type RecoveryMode,
} from "@/lib/backoffice/payment-recovery";
import {
  cancelStripeSubscriptionAtPeriodEndWithAudit,
  type CancelStripeSubscriptionError,
} from "@/lib/backoffice/stripe-subscription-cancel";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";
import {
  recordManualPaymentForUser,
  type RecordManualPaymentError,
} from "@/lib/backoffice/manual-payment-store";
import { VindiApiError } from "@/lib/vindi/client";
import { isVindiSubscriptionsEnabled } from "@/lib/vindi/config";
import { markVindiPaidOutOfBandForUser } from "@/lib/vindi/paid-out-of-band-server";
import { refundVindiPaymentForUser } from "@/lib/vindi/refund-server";
import { recoverVindiPaymentForUser } from "@/lib/vindi/recovery-charge-server";
import { cancelVindiSubscriptionForUser } from "@/lib/vindi/subscription-cancel-server";
import type { VindiBackofficeRecoveryMode } from "@/lib/vindi/recovery-charge";

const EVENT_TYPE_LABELS: Record<string, string> = {
  subscribed: "Assinatura iniciada",
  renewed: "Assinatura renovada",
  upgraded: "Upgrade de plano",
  downgraded: "Downgrade de plano",
  plan_changed: "Mudança de plano",
  canceled: "Assinatura cancelada",
  reactivated: "Assinatura reativada",
  expired: "Assinatura expirada",
  payment_failed: "Pagamento falhou",
  payment_recovered: "Pagamento recuperado",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("billing:manage");
    if (!authz.ok) return authz.response;

    const { userId } = await params;

    const [userData] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [subscriptions, payments, events, pendingChanges, pixLinks] =
      await Promise.all([
        db
          .select()
          .from(subscription)
          .where(eq(subscription.userId, userId))
          .orderBy(desc(subscription.createdAt)),
        db
          .select()
          .from(payment)
          .where(eq(payment.userId, userId))
          .orderBy(desc(payment.createdAt))
          .limit(50),
        db
          .select()
          .from(subscriptionEvent)
          .where(eq(subscriptionEvent.userId, userId))
          .orderBy(desc(subscriptionEvent.createdAt))
          .limit(50),
        db
          .select()
          .from(pendingPlanChange)
          .where(
            and(
              eq(pendingPlanChange.userId, userId),
              eq(pendingPlanChange.status, "pending"),
            ),
          )
          .orderBy(desc(pendingPlanChange.createdAt))
          .limit(1),
        db
          .select()
          .from(mercadopagoPaymentLink)
          .where(eq(mercadopagoPaymentLink.userId, userId))
          .orderBy(desc(mercadopagoPaymentLink.createdAt))
          .limit(20),
      ]);

    const activeSubscription = pickActiveSubscription(subscriptions);
    const activePendingPlanChange = pendingChanges[0] ?? null;

    return NextResponse.json({
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        locale: userData.locale,
        authProvider: userData.authProvider,
        imageUrl: userData.image_url,
        expirationDate: userData.expirationDate?.toISOString(),
        stripeCustomerId: userData.stripeCustomerId,
        credits: userData.credits,
      },
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            provider: activeSubscription.provider,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
            stripePriceId: activeSubscription.stripePriceId,
            planType: activeSubscription.planType,
            planName: PLAN_DEFINITIONS[activeSubscription.planType].name,
            status: activeSubscription.status,
            currentPeriodStart:
              activeSubscription.currentPeriodStart?.toISOString(),
            currentPeriodEnd:
              activeSubscription.currentPeriodEnd?.toISOString(),
            cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
            canceledAt: activeSubscription.canceledAt?.toISOString(),
            endedAt: activeSubscription.endedAt?.toISOString(),
            vindiSubscriptionId: activeSubscription.vindiSubscriptionId,
            vindiPaymentMethod: activeSubscription.vindiPaymentMethod,
            vindiConsentStatus: activeSubscription.vindiConsentStatus,
            commitmentEndDate:
              activeSubscription.commitmentEndDate?.toISOString(),
            commitmentMonths: activeSubscription.commitmentMonths,
            createdAt: activeSubscription.createdAt.toISOString(),
            updatedAt: activeSubscription.updatedAt.toISOString(),
          }
        : null,
      pendingPlanChange: activePendingPlanChange
        ? {
            id: activePendingPlanChange.id,
            subscriptionId: activePendingPlanChange.subscriptionId,
            currentPlanType: activePendingPlanChange.currentPlanType,
            currentPlanName:
              PLAN_DEFINITIONS[activePendingPlanChange.currentPlanType].name,
            newPlanType: activePendingPlanChange.newPlanType,
            newPlanName:
              PLAN_DEFINITIONS[activePendingPlanChange.newPlanType].name,
            newStripePriceId: activePendingPlanChange.newStripePriceId,
            changeType: activePendingPlanChange.changeType,
            effectiveDate: activePendingPlanChange.effectiveDate.toISOString(),
            status: activePendingPlanChange.status,
            createdAt: activePendingPlanChange.createdAt.toISOString(),
            updatedAt: activePendingPlanChange.updatedAt.toISOString(),
          }
        : null,
      subscriptionHistory: subscriptions.map((s) => ({
        id: s.id,
        provider: s.provider,
        stripeSubscriptionId: s.stripeSubscriptionId,
        stripePriceId: s.stripePriceId,
        vindiSubscriptionId: s.vindiSubscriptionId,
        planType: s.planType,
        planName: PLAN_DEFINITIONS[s.planType].name,
        status: s.status,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        currentPeriodStart: s.currentPeriodStart?.toISOString(),
        currentPeriodEnd: s.currentPeriodEnd?.toISOString(),
        commitmentMonths: s.commitmentMonths,
        commitmentEndDate: s.commitmentEndDate?.toISOString(),
        canceledAt: s.canceledAt?.toISOString(),
        endedAt: s.endedAt?.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        planType: p.planType,
        planName: PLAN_DEFINITIONS[p.planType].name,
        description: p.description,
        failureReason: p.failureReason,
        stripeInvoiceId: p.stripeInvoiceId,
        stripePaymentIntentId: p.stripePaymentIntentId,
        stripeChargeId: p.stripeChargeId,
        mercadopagoPaymentId: p.mercadopagoPaymentId,
        vindiBillId: p.vindiBillId,
        vindiChargeId: p.vindiChargeId,
        mercadopagoPreferenceId: p.mercadopagoPreferenceId,
        paidAt: p.paidAt?.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
      mercadopagoPaymentLinks: pixLinks.map((link) => ({
        id: link.id,
        planType: link.planType,
        planName: PLAN_DEFINITIONS[link.planType].name,
        amount: link.amount,
        currency: link.currency,
        preferenceId: link.preferenceId,
        initPoint: link.initPoint,
        status: link.status,
        source: link.source,
        adminEmail: link.adminEmail,
        expiresAt: link.expiresAt.toISOString(),
        paidAt: link.paidAt?.toISOString(),
        mercadopagoPaymentId: link.mercadopagoPaymentId,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventLabel: EVENT_TYPE_LABELS[e.eventType] || e.eventType,
        fromPlan: e.fromPlan,
        fromPlanName: e.fromPlan ? PLAN_DEFINITIONS[e.fromPlan].name : null,
        toPlan: e.toPlan,
        toPlanName: e.toPlan ? PLAN_DEFINITIONS[e.toPlan].name : null,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching user subscription details:", error);
    return NextResponse.json(
      { error: "Failed to fetch user subscription details" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("billing:manage");
    if (!authz.ok) return authz.response;

    const { userId } = await params;
    const body = await request.json();
    const { expirationDate } = body as { expirationDate: string };

    if (!expirationDate) {
      return NextResponse.json(
        { error: "expirationDate is required" },
        { status: 400 },
      );
    }

    const result = await updateUserExpirationWithAudit({
      userId,
      expirationDateInput: expirationDate,
      adminEmail: authz.actor.email,
    });

    if (!result.ok) {
      if (result.error === "invalid_date") {
        return NextResponse.json(
          { error: "Invalid date format" },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    revalidatePath(`/users/${userId}`);
    revalidatePath(`/subscriptions/${userId}`);

    return NextResponse.json({
      success: true,
      expirationDate: result.expirationDate.toISOString(),
    });
  } catch (error) {
    console.error("Error updating user expiration date:", error);
    return NextResponse.json(
      { error: "Failed to update expiration date" },
      { status: 500 },
    );
  }
}

const RECOVERY_ERROR_TO_STATUS: Record<RecoveryError, number> = {
  stripe_not_configured: 500,
  user_not_found: 404,
  no_active_subscription: 400,
  subscription_not_recoverable: 400,
  no_failed_invoice: 400,
  invoice_not_payable: 409,
  invoice_not_found: 404,
  stripe_error: 502,
};

function isRecoveryMode(value: unknown): value is RecoveryMode {
  return value === "retry" || value === "mark_paid_oob";
}

const CANCEL_STRIPE_ERROR_TO_STATUS: Record<CancelStripeSubscriptionError, number> =
  {
    stripe_not_configured: 500,
    user_not_found: 404,
    no_stripe_subscription: 400,
    already_scheduled: 409,
    stripe_error: 502,
  };

const MANUAL_PAYMENT_ERROR_TO_STATUS: Record<RecordManualPaymentError, number> =
  {
    user_not_found: 404,
    stripe_active: 400,
    duplicate_external_id: 409,
    invalid_plan: 400,
    invalid_date: 400,
    payment_date_in_future: 400,
  };

function manualPaymentErrorMessage(error: RecordManualPaymentError): string {
  switch (error) {
    case "user_not_found":
      return "Usuário não encontrado.";
    case "stripe_active":
      return "Este usuário possui assinatura Stripe ativa.";
    case "duplicate_external_id":
      return "Já existe um pagamento com este ID de transação.";
    case "invalid_plan":
      return "Plano inválido.";
    case "invalid_date":
      return "Data de pagamento inválida.";
    case "payment_date_in_future":
      return "A data do pagamento não pode ser no futuro.";
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("billing:manage");
    if (!authz.ok) return authz.response;

    const { userId } = await params;
    const body = (await request.json()) as {
      action?: string;
      mode?: string;
      planType?: unknown;
      paidOn?: unknown;
      transactionId?: unknown;
      paymentId?: string;
    };

    if (body.action === "refund_vindi_charge") {
      if (typeof body.paymentId !== "string" || !body.paymentId) {
        return NextResponse.json(
          { error: "paymentId is required" },
          { status: 400 },
        );
      }

      let result;
      try {
        result = await refundVindiPaymentForUser({
          userId,
          paymentId: body.paymentId,
          adminEmail: authz.actor.email,
        });
      } catch (error) {
        // 422 típico: conta Vindi sem saldo disponível no intermediador.
        if (error instanceof VindiApiError) {
          return NextResponse.json(
            { error: "vindi_error", message: error.message },
            { status: 422 },
          );
        }
        throw error;
      }

      if (!result.ok) {
        const messages = {
          payment_not_found: "Pagamento não encontrado para este usuário.",
          not_vindi: "Este pagamento não foi feito pela Vindi.",
          product_payment:
            "Pagamento de produto: estorne pela aba Produtos, que também reverte o pedido.",
          already_refunded: "Este pagamento já está reembolsado.",
          not_paid: "Só é possível estornar pagamento com status Pago.",
          no_charge_id:
            "Este pagamento não tem cobrança Vindi associada para estornar.",
        } as const;
        const status = result.error === "payment_not_found" ? 404 : 409;
        return NextResponse.json(
          { error: result.error, message: messages[result.error] },
          { status },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        success: true,
        chargeId: result.chargeId,
        chargeStatus: result.chargeStatus,
      });
    }

    if (body.action === "mark_vindi_paid_out_of_band") {
      if (!isVindiSubscriptionsEnabled()) {
        return NextResponse.json(
          {
            error: "vindi_disabled",
            message: "As assinaturas Vindi estão desligadas.",
          },
          { status: 409 },
        );
      }

      const result = await markVindiPaidOutOfBandForUser({
        userId,
        adminEmail: authz.actor.email,
      });

      if (!result.ok) {
        const messages = {
          user_not_found: "Usuário não encontrado.",
          no_open_bill: "Não há fatura Vindi aberta para cancelar.",
          no_plan: "Não foi possível determinar o plano para estender o acesso.",
        } as const;
        const status =
          result.error === "user_not_found"
            ? 404
            : result.error === "no_open_bill"
              ? 409
              : 400;
        return NextResponse.json(
          { error: result.error, message: messages[result.error] },
          { status },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        success: true,
        billIds: result.billIds,
        newExpiration: result.newExpiration.toISOString(),
        auditAction: result.auditAction,
      });
    }

    if (body.action === "cancel_vindi_subscription") {
      const result = await cancelVindiSubscriptionForUser({
        userId,
        adminEmail: authz.actor.email,
      });

      if (!result.ok) {
        const messages = {
          user_not_found: "Usuário não encontrado.",
          no_vindi_subscription:
            "Este usuário não possui assinatura Vindi ativa para cancelar.",
          already_scheduled:
            "Esta assinatura já está marcada para cancelar após o vencimento.",
        } as const;
        const status =
          result.error === "user_not_found"
            ? 404
            : result.error === "already_scheduled"
              ? 409
              : 400;
        return NextResponse.json(
          { error: result.error, message: messages[result.error] },
          { status },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        success: true,
        mode: result.mode,
        inSchedulingWindow: result.inSchedulingWindow,
        accessUntil: result.accessUntil.toISOString(),
      });
    }

    if (body.action === "recover_vindi_payment") {
      if (body.mode !== "retry" && body.mode !== "reissue") {
        return NextResponse.json(
          { error: "Invalid mode. Expected 'retry' or 'reissue'." },
          { status: 400 },
        );
      }

      const result = await recoverVindiPaymentForUser({
        userId,
        adminEmail: authz.actor.email,
        mode: body.mode as VindiBackofficeRecoveryMode,
      });

      if (!result.ok) {
        const messages = {
          user_not_found: "Usuário não encontrado.",
          no_vindi_subscription: "Assinatura Vindi em atraso não encontrada.",
          subscription_not_recoverable:
            "A assinatura não está em atraso para recuperação.",
          no_failed_charge: "Nenhuma cobrança Vindi falha encontrada.",
          retry_not_allowed:
            "Retentar no cartão só está disponível para cobrança de cartão.",
          pix_pending:
            "Esta fatura já tem um Pix gerado. O cliente paga pelo QR, ou aguarde o código expirar para retentar no cartão.",
        } as const;
        const status =
          result.error === "user_not_found"
            ? 404
            : result.error === "retry_not_allowed" ||
                result.error === "pix_pending"
              ? 409
              : 400;
        return NextResponse.json(
          { error: result.error, message: messages[result.error] },
          { status },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      if (result.mode === "retry") {
        return NextResponse.json({
          success: true,
          mode: result.mode,
          chargeId: result.chargeId,
          chargeStatus: result.chargeStatus,
        });
      }

      return NextResponse.json({
        success: true,
        mode: result.mode,
        reused: result.reused,
        chargeId: result.chargeId,
        billId: result.billId,
        emvPayload: result.emvPayload,
        amountCentavos: result.amountCentavos,
        expiresAt: result.expiresAt.toISOString(),
      });
    }

    if (body.action === "cancel_stripe_subscription") {
      const result = await cancelStripeSubscriptionAtPeriodEndWithAudit({
        userId,
        adminEmail: authz.actor.email,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, message: result.message },
          { status: CANCEL_STRIPE_ERROR_TO_STATUS[result.error] },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        success: true,
        cancelAt: result.cancelAt,
        cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      });
    }

    if (body.action === "record_manual_payment") {
      if (typeof body.planType !== "string" || typeof body.paidOn !== "string") {
        return NextResponse.json(
          {
            error: "invalid_plan",
            message: "Plano e data de pagamento são obrigatórios.",
          },
          { status: 400 },
        );
      }

      const result = await recordManualPaymentForUser({
        userId,
        planType: body.planType,
        paidOn: body.paidOn,
        transactionId:
          typeof body.transactionId === "string" ? body.transactionId : undefined,
        adminEmail: authz.actor.email,
      });

      if (!result.ok) {
        return NextResponse.json(
          {
            error: result.error,
            message: manualPaymentErrorMessage(result.error),
          },
          { status: MANUAL_PAYMENT_ERROR_TO_STATUS[result.error] },
        );
      }

      revalidatePath("/users");
      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        success: true,
        newExpiration: result.newExpiration.toISOString(),
        creditsGranted: result.creditsGranted,
        amountCentavos: result.amountCentavos,
        paymentId: result.paymentId,
        subscriptionId: result.subscriptionId,
      });
    }

    if (body.action !== "recover_payment") {
      return NextResponse.json(
        { error: "Unsupported action" },
        { status: 400 },
      );
    }

    if (!isRecoveryMode(body.mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Expected 'retry' or 'mark_paid_oob'." },
        { status: 400 },
      );
    }

    const result = await recoverFailedPaymentWithAudit({
      userId,
      mode: body.mode,
      adminEmail: authz.actor.email,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          message: result.message,
          stripeStatus: result.stripeStatus ?? null,
        },
        { status: RECOVERY_ERROR_TO_STATUS[result.error] },
      );
    }

    revalidatePath(`/users/${userId}`);
    revalidatePath(`/subscriptions/${userId}`);

    return NextResponse.json({
      success: true,
      mode: result.mode,
      invoiceId: result.invoiceId,
      newStripeStatus: result.newStripeStatus,
      hostedInvoiceUrl: result.hostedInvoiceUrl,
    });
  } catch (error) {
    console.error("Error handling subscription action:", error);
    return NextResponse.json(
      { error: "Failed to process subscription action" },
      { status: 500 },
    );
  }
}
