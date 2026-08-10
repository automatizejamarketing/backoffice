import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "@/lib/playbook-insights/constants";
import { evaluatePlaybookInsights } from "@/lib/playbook-insights/evaluate";
import {
  buildFullDemoCampaignMetrics,
  FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
} from "./full-demo-campaigns";

const ALL_CONSULTANT_RULE_IDS = [
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_RULE_NO_DELIVERY,
] as const;

describe("full_demo consultant fixture", () => {
  test("triggers all five consultant rule IDs with default thresholds", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const result = evaluatePlaybookInsights({
      accountId: FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
      campaigns: buildFullDemoCampaignMetrics(now),
      now,
    });

    const detectedIds = new Set(result.candidates.map((c) => c.ruleId));
    for (const ruleId of ALL_CONSULTANT_RULE_IDS) {
      expect(detectedIds.has(ruleId)).toBe(true);
    }
    expect(ALL_CONSULTANT_RULE_IDS.length).toBe(5);
  });
});
