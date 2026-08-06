import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "./constants";
import { evaluatePlaybookInsights } from "./evaluate";
import type { CampaignMetricsRow } from "./types";

function campaign(
  overrides: Partial<CampaignMetricsRow> & Pick<CampaignMetricsRow, "id" | "name">,
): CampaignMetricsRow {
  return {
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    updatedTime: null,
    spend: 100,
    purchaseRoas: 4,
    purchases: 10,
    purchaseValue: 400,
    impressions: 1000,
    cpa: 10,
    ...overrides,
  };
}

describe("evaluatePlaybookInsights", () => {
  test("flags ROAS trigger when active spend meets floor and ROAS ≤ 3", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c1",
          name: "Low ROAS",
          purchaseRoas: 2.5,
          spend: 80,
        }),
      ],
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_ROAS_TRIGGER)).toBe(
      true,
    );
  });

  test("flags ROAS scale opportunity when ROAS ≥ 5", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c2",
          name: "Scale me",
          purchaseRoas: 6,
          spend: 120,
        }),
      ],
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_ROAS_SCALE)).toBe(
      true,
    );
  });

  test("flags CPA alert above threshold", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c3",
          name: "High CPA",
          cpa: 20,
          purchaseRoas: 4,
          spend: 100,
        }),
      ],
      cpaAlertThreshold: 7.5,
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_CPA_ALERT)).toBe(
      true,
    );
  });

  test("flags stalled paused campaigns after 5 days", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      now,
      campaigns: [
        campaign({
          id: "c4",
          name: "Paused old",
          status: "PAUSED",
          effectiveStatus: "PAUSED",
          spend: 50,
          updatedTime: "2026-07-28T12:00:00.000Z",
        }),
      ],
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_STALLED)).toBe(
      true,
    );
  });

  test("flags active campaigns with zero delivery", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c5",
          name: "No delivery",
          impressions: 0,
          spend: 0,
          purchaseRoas: null,
          cpa: null,
          purchases: 0,
        }),
      ],
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_NO_DELIVERY)).toBe(
      true,
    );
  });

  test("skips ROAS rules when spend is below floor", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c6",
          name: "Tiny spend",
          purchaseRoas: 1,
          spend: 10,
        }),
      ],
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_ROAS_TRIGGER)).toBe(
      false,
    );
  });
});
