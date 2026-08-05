const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBrlCurrencyFromCentavos(centavos: number): string {
  return brlFormatter.format(centavos / 100).replace(/\u00a0/g, " ");
}

export function formatBrlCurrencyInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  if (!digits) return "";
  return formatBrlCurrencyFromCentavos(Number(digits));
}

export function parseBrlCurrencyToCentavos(value: string): number {
  const digits = value.replace(/\D/g, "");
  if (!digits) throw new Error("Preço é obrigatório");
  return Number(digits);
}
