import "server-only";
import { stripe } from "@/lib/stripe";
import type { StripeSettlement } from "./finance-dashboard";

const settlementCache = new Map<
  string,
  { expiresAt: number; value: StripeSettlement }
>();
const CACHE_TTL_MS = 15 * 60 * 1000;

async function fetchStripeSettlement(
  invoiceId: string,
): Promise<StripeSettlement | null> {
  const cached = settlementCache.get(invoiceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!stripe) return null;

  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent"],
  });
  const paidInvoicePayment =
    invoice.payments?.data.find((item) => item.status === "paid") ??
    invoice.payments?.data[0];
  const paymentIntent = paidInvoicePayment?.payment?.payment_intent;
  const expandedIntent =
    paymentIntent && typeof paymentIntent !== "string"
      ? paymentIntent
      : null;
  const latestCharge = expandedIntent?.latest_charge;
  if (!latestCharge) return null;

  const charge =
    typeof latestCharge === "string"
      ? await stripe.charges.retrieve(latestCharge, {
          expand: ["balance_transaction"],
        })
      : latestCharge;
  const transaction = charge.balance_transaction;
  if (!transaction || typeof transaction === "string") return null;

  const settlement = {
    invoiceId,
    grossAmount: transaction.amount,
    netAmount: transaction.net,
    feeAmount: transaction.fee,
  };
  settlementCache.set(invoiceId, {
    value: settlement,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return settlement;
}

export async function getStripeSettlements(
  invoiceIds: string[],
): Promise<StripeSettlement[]> {
  const uniqueInvoiceIds = [...new Set(invoiceIds)];
  if (uniqueInvoiceIds.length === 0 || !stripe) return [];

  const results = await Promise.allSettled(
    uniqueInvoiceIds.map(fetchStripeSettlement),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    console.warn(
      `[finance-dashboard] Stripe settlement unavailable for ${failed} invoice(s).`,
    );
  }

  return results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}
