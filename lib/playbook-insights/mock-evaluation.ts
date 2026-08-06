import { evaluatePlaybookInsights } from "./evaluate";
import type { CampaignMetricsRow, PlaybookEvaluationResult } from "./types";

/**
 * Synthetic campaigns that exercise every playbook rule for UI/staging demos.
 * No Meta calls — evidence/recommendation text comes from the real evaluator.
 */
export function buildMockPlaybookEvaluation(
  now = new Date(),
): PlaybookEvaluationResult {
  const pausedUpdated = new Date(
    now.getTime() - 8 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const campaigns: CampaignMetricsRow[] = [
    {
      id: "mock_campaign_roas_low",
      name: "[MOCK] Vendas — ROAS baixo",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      spend: 220,
      purchaseRoas: 2.1,
      purchases: 12,
      purchaseValue: 462,
      impressions: 48_000,
      cpa: 18.33,
    },
    {
      id: "mock_campaign_roas_scale",
      name: "[MOCK] Vendas — ROAS validado",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      spend: 310,
      purchaseRoas: 6.4,
      purchases: 40,
      purchaseValue: 1984,
      impressions: 72_000,
      cpa: 7.75,
    },
    {
      id: "mock_campaign_cpa_high",
      name: "[MOCK] Conversão — CPA alto",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      spend: 150,
      purchaseRoas: 3.5,
      purchases: 8,
      purchaseValue: 525,
      impressions: 30_000,
      cpa: 18.75,
    },
    {
      id: "mock_campaign_stalled",
      name: "[MOCK] Remarketing — pausada",
      status: "PAUSED",
      effectiveStatus: "PAUSED",
      updatedTime: pausedUpdated,
      spend: 95,
      purchaseRoas: 4.2,
      purchases: 10,
      purchaseValue: 399,
      impressions: 22_000,
      cpa: 9.5,
    },
    {
      id: "mock_campaign_no_delivery",
      name: "[MOCK] Tráfego — sem entrega",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      spend: 0,
      purchaseRoas: null,
      purchases: 0,
      purchaseValue: 0,
      impressions: 0,
      cpa: null,
    },
  ];

  return evaluatePlaybookInsights({
    accountId: "act_mock_playbook_staging",
    campaigns,
    now,
  });
}
