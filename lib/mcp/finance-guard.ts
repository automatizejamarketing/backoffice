import { hasFinanceAccess } from "@/lib/auth/finance-access";
import type { BackofficeActor } from "@/lib/auth/rbac-core";

/**
 * MCP answers never carry Automatize money to someone without Financeiro
 * access: a dev who runs WhatsApp campaigns gets sends, clicks, trials and
 * payment counts, but not the revenue in reais attributed to the campaign.
 */
export function campaignMetricsFor<M extends { revenue_centavos: number }>(
  actor: BackofficeActor,
  metrics: M,
): Omit<M, "revenue_centavos"> & { revenueReais?: number; revenue?: "restrito ao Financeiro" } {
  const { revenue_centavos: revenueCentavos, ...rest } = metrics;
  return hasFinanceAccess(actor)
    ? { ...rest, revenueReais: revenueCentavos / 100 }
    : { ...rest, revenue: "restrito ao Financeiro" };
}
