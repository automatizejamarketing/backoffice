import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "./constants";
import {
  formatMinorUnitsBRL,
  isPlaybookApplyActionAllowed,
  listPlaybookApplyActions,
  playbookApplyChangeNote,
  scaleMinorUnits,
} from "./actions";

describe("listPlaybookApplyActions", () => {
  test("stalled offers reactivate and archive", () => {
    const actions = listPlaybookApplyActions({
      ruleId: PLAYBOOK_RULE_STALLED,
      metrics: { pausedDays: 8 },
    });
    expect(actions.map((a) => a.id)).toEqual(["reactivate", "archive"]);
  });

  test("validated ROAS on an active campaign offers a 20% budget scale", () => {
    const actions = listPlaybookApplyActions({
      ruleId: PLAYBOOK_RULE_ROAS_SCALE,
      metrics: { effectiveStatus: "ACTIVE", purchaseRoas: 6.2 },
    });
    expect(actions.map((a) => a.id)).toEqual(["scale_budget"]);
  });

  test("validated ROAS on an ended campaign offers duplicate", () => {
    const actions = listPlaybookApplyActions({
      ruleId: PLAYBOOK_RULE_ROAS_SCALE,
      metrics: { effectiveStatus: "COMPLETED" },
    });
    expect(actions.map((a) => a.id)).toEqual(["duplicate"]);
    expect(
      isPlaybookApplyActionAllowed(
        { ruleId: PLAYBOOK_RULE_ROAS_SCALE, metrics: { effectiveStatus: "ARCHIVED" } },
        "duplicate",
      ),
    ).toBe(true);
    expect(
      isPlaybookApplyActionAllowed(
        { ruleId: PLAYBOOK_RULE_ROAS_SCALE, metrics: { effectiveStatus: "ACTIVE" } },
        "duplicate",
      ),
    ).toBe(false);
  });

  test("diagnostic rules stay review-only", () => {
    for (const ruleId of [
      PLAYBOOK_RULE_ROAS_TRIGGER,
      PLAYBOOK_RULE_CPA_ALERT,
      PLAYBOOK_RULE_NO_DELIVERY,
    ]) {
      expect(listPlaybookApplyActions({ ruleId, metrics: {} })).toEqual([]);
    }
  });
});

describe("scaleMinorUnits", () => {
  test("raises a daily budget by 20%", () => {
    expect(scaleMinorUnits("1500")).toBe("1800");
  });

  test("always increases by at least 1 cent", () => {
    expect(scaleMinorUnits("1")).toBe("2");
  });

  test("rejects empty or zero budgets", () => {
    expect(scaleMinorUnits("0")).toBeNull();
    expect(scaleMinorUnits("")).toBeNull();
  });
});

describe("playbookApplyChangeNote", () => {
  test("includes the campaign name for the audit trail", () => {
    expect(playbookApplyChangeNote("reactivate", "Promo Delivery")).toBe(
      'Playbook: reativar campanha parada "Promo Delivery"',
    );
  });
});

describe("formatMinorUnitsBRL", () => {
  test("formats cents as reais", () => {
    expect(formatMinorUnitsBRL("1800")).toBe("R$ 18.00");
  });
});
