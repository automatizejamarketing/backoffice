import { ACCOUNT_RULE_CARD_PAYMENT_FAILED } from "@/lib/account-alerts/constants";
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

/**
 * Account alerts come from Automatize subscriptions. All are fixed sentences
 * without amounts except the card failure, whose evidence quotes the provider's
 * free-text reason ("Falha na cobrança de R$ 199,00", or the amount spelled
 * out). Without Financeiro access that reason is replaced as a whole, keeping
 * provider and status (enum words from our own template). Recommendations are
 * fixed text; playbook and drop alerts are about the client's own ad money.
 */
export function alertEvidenceFor(actor: BackofficeActor, ruleId: string, evidence: string): string {
  if (ruleId !== ACCOUNT_RULE_CARD_PAYMENT_FAILED || hasFinanceAccess(actor)) return evidence;
  const head = /^Assinatura [A-Za-z]+ [a-z_]+/.exec(evidence)?.[0] ?? "Assinatura";
  return `${head} com cobrança no cartão que não passou. Motivo restrito ao Financeiro.`;
}
