import { hasFinanceAccess } from "@/lib/auth/finance-access";
import type { BackofficeActor } from "@/lib/auth/rbac-core";

/**
 * MCP answers never carry Automatize money to someone without Financeiro
 * access. The line (JP, 09/10/2026) is money: counts and subscription status
 * stay, as on the Painel, Carteira and Alertas screens; reais of revenue do not.
 */
type CampaignMetrics = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  tracked_clicks: number;
  trials: number;
  paying: number;
  windowDays: number;
  revenue_centavos: number;
};

/** Copies only known fields, so a money column added to the query later does not pass through. */
export function campaignMetricsFor(actor: BackofficeActor, m: CampaignMetrics) {
  const results = {
    total: m.total, sent: m.sent, delivered: m.delivered, read: m.read, failed: m.failed,
    trackedClicks: m.tracked_clicks, trials: m.trials, paying: m.paying, windowDays: m.windowDays,
  };
  return hasFinanceAccess(actor)
    ? { ...results, revenueReais: m.revenue_centavos / 100 }
    : { ...results, revenue: "restrito ao Financeiro" as const };
}
