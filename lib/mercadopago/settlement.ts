import type { MercadoPagoPayment } from "./fetch-payment";

export function toMercadoPagoCentavos(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value ?? 0) * 100);
}

export function toNullableMercadoPagoCentavos(
  value: number | undefined,
): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round((value ?? 0) * 100);
}

function getMercadoPagoFeeAmountCentavos(
  feeDetails: Array<{ amount?: number }> | undefined,
): number | null {
  if (!feeDetails?.length) return null;
  return feeDetails.reduce(
    (total, fee) => total + toMercadoPagoCentavos(fee.amount),
    0,
  );
}

export function getMercadoPagoSettlementAmounts(
  payment: Pick<
    MercadoPagoPayment,
    "transaction_amount" | "transaction_details" | "fee_details"
  >,
) {
  return {
    grossAmount: toMercadoPagoCentavos(payment.transaction_amount),
    netAmount: toNullableMercadoPagoCentavos(
      payment.transaction_details?.net_received_amount,
    ),
    feeAmount: getMercadoPagoFeeAmountCentavos(payment.fee_details),
  };
}

export function hasMercadoPagoSettlementCoverage(
  payment: Pick<
    MercadoPagoPayment,
    "transaction_amount" | "transaction_details" | "fee_details"
  >,
) {
  const { netAmount, feeAmount } = getMercadoPagoSettlementAmounts(payment);
  return netAmount !== null || feeAmount !== null;
}
