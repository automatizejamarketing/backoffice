export function formatPercentageInput(value: string): string {
  const normalized = value
    .replace(".", ",")
    .replace(/[^\d,]/g, "")
    .replace(/(,.*),/g, "$1");
  if (!normalized) return "";

  const [integerPart = "0", decimalPart] = normalized.split(",");
  const numeric = Number(
    `${integerPart || "0"}.${(decimalPart ?? "").slice(0, 2)}`,
  );
  if (!Number.isFinite(numeric)) return "";
  if (numeric >= 100) return "100%";

  const cleanInteger = String(Number(integerPart || "0"));
  const cleanDecimal = decimalPart?.slice(0, 2);
  return `${cleanInteger}${decimalPart !== undefined ? `,${cleanDecimal}` : ""}%`;
}

export function parsePercentageInput(value: string): number {
  const numeric = Number(value.replace("%", "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}
