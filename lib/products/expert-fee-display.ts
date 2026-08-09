import { formatBrlCurrencyFromCentavos } from "./currency-input";

export function calculateExpertPlatformFeeCentavos(
  grossCentavos: number,
  basisPoints: number,
  fixedCentavos: number,
): number {
  if (grossCentavos <= 0) return 0;
  const fee = Math.round((grossCentavos * basisPoints) / 10_000) + fixedCentavos;
  return Math.min(grossCentavos, fee);
}

export function formatExpertPlatformFee(
  basisPoints: number,
  fixedCentavos: number,
): string {
  const percentage = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: basisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(basisPoints / 100);
  return `${percentage}% + ${formatBrlCurrencyFromCentavos(fixedCentavos)}`;
}

export function formatExpertMarketplaceFee(basisPoints: number): string {
  const percentage = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: basisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(basisPoints / 100);
  return `+${percentage}% via marketplace`;
}

export function formatExpertPlatformFeePreview(
  basisPoints: number,
  fixedCentavos: number,
): string {
  const fee = calculateExpertPlatformFeeCentavos(
    10_000,
    basisPoints,
    fixedCentavos,
  );
  return `Em uma venda de R$ 100,00, a taxa é ${formatBrlCurrencyFromCentavos(fee)}.`;
}
