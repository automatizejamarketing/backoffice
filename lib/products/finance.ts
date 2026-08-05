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
