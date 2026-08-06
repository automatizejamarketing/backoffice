import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "./constants";
import { buildMockPlaybookEvaluation } from "./mock-evaluation";

describe("buildMockPlaybookEvaluation", () => {
  test("produces candidates for every playbook rule", () => {
    const result = buildMockPlaybookEvaluation(
      new Date("2026-08-06T12:00:00.000Z"),
    );
    const ruleIds = new Set(result.candidates.map((c) => c.ruleId));

    expect(ruleIds.has(PLAYBOOK_RULE_ROAS_TRIGGER)).toBe(true);
    expect(ruleIds.has(PLAYBOOK_RULE_ROAS_SCALE)).toBe(true);
    expect(ruleIds.has(PLAYBOOK_RULE_CPA_ALERT)).toBe(true);
    expect(ruleIds.has(PLAYBOOK_RULE_STALLED)).toBe(true);
    expect(ruleIds.has(PLAYBOOK_RULE_NO_DELIVERY)).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(5);
  });
});
