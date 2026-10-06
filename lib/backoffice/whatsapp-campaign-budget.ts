/** Currency input stores a formatted BRL string; typed digits represent cents. */
export function campaignBudgetMicros(value: string): number {
  return Number(value.replace(/\D/g, "") || "0") * 10_000;
}

export function formatCampaignBudgetInput(value: string): string {
  if (!value.replace(/\D/g, "")) return "";
  return (campaignBudgetMicros(value) / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function campaignBudgetReach(budgetMicros: number, unitCostMicros?: number): number | null {
  if (!unitCostMicros || unitCostMicros <= 0 || !Number.isFinite(unitCostMicros)) return null;
  if (!Number.isFinite(budgetMicros) || budgetMicros < 0) return null;
  return Math.floor(budgetMicros / unitCostMicros);
}
