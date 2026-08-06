export function calculateAutomatizeNetRevenueCentavos(
  netRevenueCentavos: number,
  expertRevenueCentavos: number,
) {
  if (
    !Number.isSafeInteger(netRevenueCentavos) ||
    !Number.isSafeInteger(expertRevenueCentavos) ||
    netRevenueCentavos < 0 ||
    expertRevenueCentavos < 0
  ) {
    throw new Error("Revenue values must be non-negative integers");
  }

  if (expertRevenueCentavos > netRevenueCentavos) {
    throw new Error("Expert revenue cannot exceed net revenue");
  }

  return netRevenueCentavos - expertRevenueCentavos;
}

export function calculateExpertShare(
  netAmountCentavos: number,
  expertShareBasisPoints: number,
): number {
  if (!Number.isInteger(netAmountCentavos) || netAmountCentavos < 0) {
    throw new Error("Net amount must be a non-negative integer");
  }
  if (
    !Number.isInteger(expertShareBasisPoints) ||
    expertShareBasisPoints < 0 ||
    expertShareBasisPoints > 10_000
  ) {
    throw new Error("Expert share must be between 0 and 10000 basis points");
  }

  return Math.round((netAmountCentavos * expertShareBasisPoints) / 10_000);
}
