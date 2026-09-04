/** Proporcionalidade da `refund_application_fee` na Cobrança Direta.
 *
 * Reembolso parcial de valor R sobre bruto B com application_fee F devolve
 * round(F × R / B) half-up — o mesmo arredondamento de `gateway-net-v1.ts`.
 * Reembolso total devolve F inteiro. */
export function calculateProportionalRefundApplicationFee(input: {
  refundAmountCentavos: number;
  grossAmountCentavos: number;
  applicationFeeCentavos: number;
}): number {
  const refundAmountCentavos = assertNonNegativeInteger(
    input.refundAmountCentavos,
    "refund amount",
  );
  const grossAmountCentavos = assertNonNegativeInteger(
    input.grossAmountCentavos,
    "gross amount",
  );
  const applicationFeeCentavos = assertNonNegativeInteger(
    input.applicationFeeCentavos,
    "application fee",
  );

  if (applicationFeeCentavos === 0) return 0;
  if (refundAmountCentavos === 0) return 0;
  if (refundAmountCentavos >= grossAmountCentavos) return applicationFeeCentavos;

  return Math.round(
    (applicationFeeCentavos * refundAmountCentavos) / grossAmountCentavos,
  );
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
