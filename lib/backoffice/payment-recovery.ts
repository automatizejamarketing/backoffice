import { and, desc, eq, isNotNull } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  payment,
  subscription,
  user,
  type Payment,
  type Subscription,
} from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";

export type RecoveryMode = "retry" | "mark_paid_oob";

export type RecoveryError =
  | "stripe_not_configured"
  | "user_not_found"
  | "no_active_subscription"
  | "subscription_not_recoverable"
  | "no_failed_invoice"
  | "invoice_not_payable"
  | "stripe_error";

export type RecoveryResult =
  | {
      ok: true;
      mode: RecoveryMode;
      invoiceId: string;
      newStripeStatus: Stripe.Invoice.Status | null;
      hostedInvoiceUrl: string | null;
    }
  | {
      ok: false;
      error: RecoveryError;
      message: string;
      stripeStatus?: Stripe.Invoice.Status | null;
    };

const RECOVERABLE_SUB_STATUSES = ["past_due", "unpaid"] as const;

function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError;
}

async function findLatestRecoverablePayment(
  userId: string,
  activeSubscriptionId: string,
): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payment)
    .where(
      and(
        eq(payment.userId, userId),
        eq(payment.subscriptionId, activeSubscriptionId),
        eq(payment.status, "failed"),
        isNotNull(payment.stripeInvoiceId),
      ),
    )
    .orderBy(desc(payment.createdAt))
    .limit(1);
  return row ?? null;
}

async function pickActiveSubscriptionForUser(
  userId: string,
): Promise<Subscription | null> {
  const rows = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId));
  return pickActiveSubscription(rows);
}

async function logAudit(args: {
  adminEmail: string;
  userId: string;
  mode: RecoveryMode;
  invoiceId: string;
  ok: boolean;
  newValue: string;
  note?: string;
}): Promise<void> {
  await db.insert(backofficeAuditLog).values({
    adminEmail: args.adminEmail,
    targetUserId: args.userId,
    action:
      args.mode === "mark_paid_oob"
        ? "mark_payment_paid_oob"
        : "recover_payment",
    fieldName: "payment_status",
    oldValue: "failed",
    newValue: args.newValue,
    note: args.note ?? null,
  });
}

/**
 * Triggers a one-shot recovery on the user's most recent failed Stripe invoice.
 *
 * Two modes:
 *  - "retry": calls `stripe.invoices.pay(invoiceId)` against the customer's
 *    default payment method (use after the customer says "try again, my card
 *    has funds now" or after they've added a new default PM in Stripe).
 *  - "mark_paid_oob": calls `stripe.invoices.pay(invoiceId, { paid_out_of_band: true })`,
 *    which closes the invoice as paid WITHOUT charging the card. Use only when
 *    the customer paid via PIX, bank transfer, or another off-Stripe channel.
 *
 * IMPORTANT contract: this helper does NOT mutate `payments` or `subscription`
 * rows directly. The frontend webhook (`automatize-frontend/app/api/stripe/webhook/route.ts`,
 * handler `invoice.payment_succeeded`) is the single writer for those tables and
 * is responsible for inserting the success payment row, flipping subscription
 * status back to `active`, extending `users.expiration_date`, depositing
 * monthly credits, and emitting the `payment_recovered` event. We only fire
 * the Stripe call here and audit it.
 */
export async function recoverFailedPaymentWithAudit(args: {
  userId: string;
  mode: RecoveryMode;
  adminEmail: string;
}): Promise<RecoveryResult> {
  const { userId, mode, adminEmail } = args;

  if (!stripe) {
    return {
      ok: false,
      error: "stripe_not_configured",
      message: "STRIPE_SECRET_KEY não configurada no backoffice.",
    };
  }

  const [foundUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!foundUser) {
    return {
      ok: false,
      error: "user_not_found",
      message: "Usuário não encontrado.",
    };
  }

  const activeSub = await pickActiveSubscriptionForUser(userId);
  if (!activeSub) {
    return {
      ok: false,
      error: "no_active_subscription",
      message: "Este usuário não possui assinatura ativa para recuperar.",
    };
  }

  if (
    !RECOVERABLE_SUB_STATUSES.includes(
      activeSub.status as (typeof RECOVERABLE_SUB_STATUSES)[number],
    )
  ) {
    return {
      ok: false,
      error: "subscription_not_recoverable",
      message: `A assinatura está com status '${activeSub.status}' e não é elegível para recuperação. Apenas 'past_due' e 'unpaid' são recuperáveis.`,
    };
  }

  const failedPayment = await findLatestRecoverablePayment(userId, activeSub.id);
  if (!failedPayment || !failedPayment.stripeInvoiceId) {
    return {
      ok: false,
      error: "no_failed_invoice",
      message:
        "Nenhuma fatura falha encontrada para esta assinatura no histórico.",
    };
  }

  const invoiceId = failedPayment.stripeInvoiceId;

  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (error) {
    const message = isStripeError(error)
      ? error.message
      : "Erro ao consultar a fatura no Stripe.";
    await logAudit({
      adminEmail,
      userId,
      mode,
      invoiceId,
      ok: false,
      newValue: "failed",
      note: `retrieve_failed: ${message}`,
    });
    return {
      ok: false,
      error: "stripe_error",
      message,
    };
  }

  if (invoice.status !== "open") {
    return {
      ok: false,
      error: "invoice_not_payable",
      message: `Esta fatura não pode mais ser cobrada (status atual no Stripe: '${invoice.status ?? "desconhecido"}'). Faturas só podem ser recuperadas enquanto estão 'open'.`,
      stripeStatus: invoice.status,
    };
  }

  let paidInvoice: Stripe.Invoice;
  try {
    paidInvoice = await stripe.invoices.pay(
      invoiceId,
      mode === "mark_paid_oob" ? { paid_out_of_band: true } : {},
    );
  } catch (error) {
    const message = isStripeError(error)
      ? `${error.message}${error.code ? ` (code: ${error.code})` : ""}`
      : "Erro inesperado ao tentar pagar a fatura no Stripe.";
    await logAudit({
      adminEmail,
      userId,
      mode,
      invoiceId,
      ok: false,
      newValue: "failed",
      note: `pay_failed: ${message}`,
    });
    return {
      ok: false,
      error: "stripe_error",
      message,
      stripeStatus: invoice.status,
    };
  }

  await logAudit({
    adminEmail,
    userId,
    mode,
    invoiceId,
    ok: true,
    newValue: paidInvoice.status === "paid" ? "paid" : (paidInvoice.status ?? "unknown"),
    note:
      mode === "mark_paid_oob"
        ? "Marked as paid out of band (PIX/transfer)."
        : "Retried charge via stripe.invoices.pay().",
  });

  console.info(
    `[payment-recovery] invoice ${invoiceId} for user ${userId} → status='${paidInvoice.status}' (mode='${mode}'). Webhook invoice.payment_succeeded will sync DB state.`,
  );

  return {
    ok: true,
    mode,
    invoiceId,
    newStripeStatus: paidInvoice.status,
    hostedInvoiceUrl: paidInvoice.hosted_invoice_url ?? null,
  };
}
