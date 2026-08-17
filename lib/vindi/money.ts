export function centavosToVindiAmount(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new Error("amount must be a non-negative integer in centavos");
  }
  return (centavos / 100).toFixed(2);
}

export function vindiAmountToCentavos(amount: string | number): number {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("invalid Vindi amount");
  }
  return Math.round(value * 100);
}
