import {
  EMPTY_ROAS_LOOKBACK,
  type CampaignMetricsRow,
} from "@/lib/playbook-insights/types";
import { META_FAKE_SCENARIO_KEY } from "./config";

/**
 * Synthetic campaigns that exercise every consultant playbook rule
 * when evaluated with default (or DB-compatible) thresholds.
 */
export function buildFullDemoCampaignMetrics(
  now = new Date(),
): CampaignMetricsRow[] {
  const pausedUpdated = new Date(
    now.getTime() - 8 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const createdTime = now.toISOString();

  return [
    {
      id: "fake_campaign_roas_low",
      name: `[${META_FAKE_SCENARIO_KEY}] Vendas — ROAS baixo`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      createdTime,
      stopTime: null,
      objective: "OUTCOME_SALES",
      spend: 220,
      spendLast10Days: 220,
      purchaseRoas: 2.1,
      purchases: 12,
      purchaseValue: 462,
      impressions: 48_000,
      cpa: 18.33,
      ...EMPTY_ROAS_LOOKBACK,
    },
    {
      id: "fake_campaign_roas_scale",
      name: `[${META_FAKE_SCENARIO_KEY}] Vendas — ROAS validado`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      createdTime,
      stopTime: null,
      objective: "OUTCOME_SALES",
      spend: 310,
      spendLast10Days: 310,
      purchaseRoas: 6.4,
      purchases: 40,
      purchaseValue: 1984,
      impressions: 72_000,
      cpa: 7.75,
      lookbackDays: 7,
      spendLookback: 90,
      purchaseRoasLookback: 4.2,
      purchasesLookback: 10,
      spendPrevious: 110,
      purchaseRoasPrevious: 8.4,
      purchasesPrevious: 18,
    },
    {
      id: "fake_campaign_cpa_high",
      name: `[${META_FAKE_SCENARIO_KEY}] Conversão — CPA alto`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      createdTime,
      stopTime: null,
      objective: "OUTCOME_SALES",
      spend: 150,
      spendLast10Days: 150,
      purchaseRoas: 3.5,
      purchases: 8,
      purchaseValue: 525,
      impressions: 30_000,
      cpa: 18.75,
      ...EMPTY_ROAS_LOOKBACK,
    },
    {
      id: "fake_campaign_stalled",
      name: `[${META_FAKE_SCENARIO_KEY}] Remarketing — pausada`,
      status: "PAUSED",
      effectiveStatus: "PAUSED",
      updatedTime: pausedUpdated,
      createdTime,
      stopTime: null,
      objective: "OUTCOME_SALES",
      spend: 95,
      spendLast10Days: 95,
      purchaseRoas: 4.2,
      purchases: 10,
      purchaseValue: 399,
      impressions: 22_000,
      cpa: 9.5,
      ...EMPTY_ROAS_LOOKBACK,
    },
    {
      id: "fake_campaign_no_delivery",
      name: `[${META_FAKE_SCENARIO_KEY}] Tráfego — sem entrega`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: now.toISOString(),
      createdTime,
      stopTime: null,
      objective: "OUTCOME_TRAFFIC",
      spend: 0,
      spendLast10Days: 0,
      purchaseRoas: null,
      purchases: 0,
      purchaseValue: 0,
      impressions: 0,
      cpa: null,
      ...EMPTY_ROAS_LOOKBACK,
    },
  ];
}

export const FULL_DEMO_PLAYBOOK_ACCOUNT_ID = "act_fake_full_demo";
