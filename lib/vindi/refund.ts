import type { PaymentStatus } from "@/lib/db/schema";
import type { VindiClient } from "./client";

export const VINDI_REFUND_ACTION = "vindi_refund_charge" as const;

// O que a decisão de estorno precisa saber de uma linha de `payments`.
export type VindiRefundablePayment = {
  id: string;
  userId: string;
  provider: string;
  status: PaymentStatus;
  purpose: string | null;
  vindiChargeId: string | null;
  amount: number;
  currency: string;
};

export type VindiRefundDecision =
  | { ok: true; chargeId: string }
  | {
      ok: false;
      reason: "not_vindi" | "product_payment" | "already_refunded" | "not_paid" | "no_charge_id";
    };

// Estorno de pedido de produto sai pela aba Produtos, que também reverte o
// pedido, o acesso e o ledger do expert. Aqui só assinatura e pack.
export function decideVindiPaymentRefund(
  payment: Pick<
    VindiRefundablePayment,
    "provider" | "status" | "purpose" | "vindiChargeId"
  >,
): VindiRefundDecision {
  if (payment.provider !== "vindi") return { ok: false, reason: "not_vindi" };
  if (payment.purpose === "product") {
    return { ok: false, reason: "product_payment" };
  }
  if (payment.status === "refunded") {
    return { ok: false, reason: "already_refunded" };
  }
  if (payment.status !== "succeeded") return { ok: false, reason: "not_paid" };
  if (!payment.vindiChargeId) return { ok: false, reason: "no_charge_id" };
  return { ok: true, chargeId: payment.vindiChargeId };
}

export type VindiChargeRefundResponse = {
  charge?: {
    id?: number | string;
    status?: string;
    last_transaction?: {
      id?: number | string;
      status?: string;
      transaction_type?: string;
    } | null;
  } | null;
};

// Estorno sempre total: sem `amount` no corpo, a Vindi devolve o valor cheio.
export async function refundVindiCharge(
  client: VindiClient,
  chargeId: string,
): Promise<{ chargeStatus: string | null }> {
  const response = await client.request<VindiChargeRefundResponse>({
    method: "POST",
    path: `/v1/charges/${chargeId}/refund`,
  });
  return { chargeStatus: response.charge?.status ?? null };
}

export type VindiRefundStore = {
  getPayment(paymentId: string): Promise<VindiRefundablePayment | null>;
  markRefunded(input: {
    paymentId: string;
    refundedAmount: number;
    now: Date;
  }): Promise<void>;
  writeAudit(entry: {
    adminEmail: string;
    targetUserId: string;
    action: typeof VINDI_REFUND_ACTION;
    fieldName: string;
    oldValue: string | null;
    newValue: string;
    note: string | null;
  }): Promise<void>;
};

export type VindiRefundResult =
  | { ok: true; chargeId: string; chargeStatus: string | null }
  | {
      ok: false;
      error:
        | "payment_not_found"
        | "not_vindi"
        | "product_payment"
        | "already_refunded"
        | "not_paid"
        | "no_charge_id";
    };

// Marca a linha de `payments` na hora (o admin precisa ver o resultado), e o
// webhook charge_refunded do frontend re-aplica a mesma escrita depois — as
// duas são idempotentes entre si. Acesso e créditos do usuário NÃO mudam:
// política acordada em 2026-08-21, o admin ajusta manualmente se for o caso.
export async function refundVindiPayment(input: {
  client: VindiClient;
  store: VindiRefundStore;
  userId: string;
  paymentId: string;
  adminEmail: string;
  now: Date;
}): Promise<VindiRefundResult> {
  const payment = await input.store.getPayment(input.paymentId);
  if (!payment || payment.userId !== input.userId) {
    return { ok: false, error: "payment_not_found" };
  }

  const decision = decideVindiPaymentRefund(payment);
  if (!decision.ok) return { ok: false, error: decision.reason };

  const { chargeStatus } = await refundVindiCharge(
    input.client,
    decision.chargeId,
  );

  await input.store.markRefunded({
    paymentId: payment.id,
    refundedAmount: payment.amount,
    now: input.now,
  });
  await input.store.writeAudit({
    adminEmail: input.adminEmail,
    targetUserId: payment.userId,
    action: VINDI_REFUND_ACTION,
    fieldName: "payment_status",
    oldValue: payment.status,
    newValue: "refunded",
    note: `Vindi charge ${decision.chargeId} · ${payment.amount} centavos ${payment.currency.toUpperCase()}`,
  });

  return { ok: true, chargeId: decision.chargeId, chargeStatus };
}
