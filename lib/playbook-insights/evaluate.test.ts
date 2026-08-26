import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "./constants";
import { evaluatePlaybookInsights } from "./evaluate";
import type { CampaignMetricsRow } from "./types";

const CONNECTION_CREATED_AT = new Date("2026-06-01T00:00:00.000Z");

function campaign(
  overrides: Partial<CampaignMetricsRow> & Pick<CampaignMetricsRow, "id" | "name">,
): CampaignMetricsRow {
  return {
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    updatedTime: null,
    createdTime: "2026-07-01T00:00:00.000Z",
    spend: 100,
    spendLast10Days: 100,
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

  test("honors dynamic thresholds from config", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c7",
          name: "Borderline ROAS",
          purchaseRoas: 3.5,
          spend: 80,
        }),
      ],
      config: {
        enabledRuleIds: new Set([PLAYBOOK_RULE_ROAS_TRIGGER]),
        thresholdsByRuleId: new Map([
          [PLAYBOOK_RULE_ROAS_TRIGGER, { minSpend: 50, roasTrigger: 4 }],
        ]),
      },
    });
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_ROAS_TRIGGER)).toBe(
      true,
    );
  });

  test("skips disabled rules from config", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [
        campaign({
          id: "c8",
          name: "Low ROAS disabled",
          purchaseRoas: 1,
          spend: 80,
        }),
      ],
      config: {
        enabledRuleIds: new Set(),
      },
    });
    expect(result.candidates).toHaveLength(0);
  });

  test("includes a new zero-spend campaign created after the Meta connection", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      connectionCreatedAt: CONNECTION_CREATED_AT,
      campaigns: [
        campaign({
          id: "c-new",
          name: "New no delivery",
          createdTime: "2026-06-01T00:00:00.000Z",
          spend: 0,
          spendLast10Days: 0,
          impressions: 0,
          purchaseRoas: null,
          cpa: null,
          purchases: 0,
        }),
      ],
    });
    expect(result.campaigns.map((row) => row.id)).toEqual(["c-new"]);
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_NO_DELIVERY)).toBe(
      true,
    );
  });

  test("includes a legacy campaign with any spend in the last 10 days", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      connectionCreatedAt: CONNECTION_CREATED_AT,
      campaigns: [
        campaign({
          id: "c-legacy-spend",
          name: "Legacy with spend",
          createdTime: "2025-01-01T00:00:00.000Z",
          purchaseRoas: 2,
          spend: 80,
          spendLast10Days: 0.01,
        }),
      ],
    });
    expect(result.campaigns.map((row) => row.id)).toEqual(["c-legacy-spend"]);
    expect(result.candidates.some((c) => c.ruleId === PLAYBOOK_RULE_ROAS_TRIGGER)).toBe(
      true,
    );
  });

  test("excludes a legacy campaign with no recent spend", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      connectionCreatedAt: CONNECTION_CREATED_AT,
      campaigns: [
        campaign({
          id: "c-legacy-quiet",
          name: "Legacy quiet",
          createdTime: "2025-01-01T00:00:00.000Z",
          purchaseRoas: 1,
          spend: 200,
          spendLast10Days: 0,
        }),
      ],
    });
    expect(result.campaigns).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  test("missing or invalid createdTime qualifies only through recent spend", () => {
    const missing = evaluatePlaybookInsights({
      accountId: "act_1",
      connectionCreatedAt: CONNECTION_CREATED_AT,
      campaigns: [
        campaign({
          id: "c-missing",
          name: "Missing created",
          createdTime: null,
          spend: 200,
          spendLast10Days: 0,
          purchaseRoas: 1,
        }),
        campaign({
          id: "c-invalid",
          name: "Invalid created",
          createdTime: "not-a-date",
          spend: 200,
          spendLast10Days: 0,
          purchaseRoas: 1,
        }),
        campaign({
          id: "c-missing-spend",
          name: "Missing created with spend",
          createdTime: null,
          spend: 80,
          spendLast10Days: 5,
          purchaseRoas: 2,
        }),
      ],
    });
    expect(missing.campaigns.map((row) => row.id)).toEqual(["c-missing-spend"]);
  });

  test("includes a campaign created at the exact connection cutoff", () => {
    const result = evaluatePlaybookInsights({
      accountId: "act_1",
      connectionCreatedAt: CONNECTION_CREATED_AT,
      campaigns: [
        campaign({
          id: "c-cutoff",
          name: "Exact cutoff",
          createdTime: CONNECTION_CREATED_AT.toISOString(),
          spend: 0,
          spendLast10Days: 0,
          impressions: 0,
          purchaseRoas: null,
          cpa: null,
          purchases: 0,
        }),
      ],
    });
    expect(result.campaigns.map((row) => row.id)).toEqual(["c-cutoff"]);
  });

  test("creative diagnosis can blame the piece or say the piece looks fine", () => {
    const blamed = evaluatePlaybookInsights({
      accountId: "act_1",
      campaigns: [campaign({ id: "camp-1", name: "Vendas" })],
      creativeDiagnoses: [
        {
          id: "d-blame",
          adId: "ad-weak",
          campaignId: "camp-1",
          adName: "Combo",
          likelyContributor: true,
          confidence: "high",
          diagnosis: {
            likelyContributor: true,
            confidence: "high",
            summary: "O gancho dos 3s não mostra o prato.",
            alternativeExplanations: [],
            craftGaps: [],
            citations: [],
          },
        },
        {
          id: "d-ok",
          adId: "ad-ok",
          campaignId: "camp-1",
          adName: "Story",
          likelyContributor: false,
          confidence: "high",
          diagnosis: {
            likelyContributor: false,
            confidence: "high",
            summary: "A peça está alinhada ao ofício.",
            alternativeExplanations: ["Tracking do pixel pode estar atrasado."],
            craftGaps: [],
            citations: [],
          },
        },
        {
          id: "d-medium-blame",
          adId: "ad-maybe",
          campaignId: "camp-1",
          adName: "Feed",
          likelyContributor: true,
          confidence: "medium",
          diagnosis: {
            likelyContributor: true,
            confidence: "medium",
            summary: "Talvez o CTA.",
            alternativeExplanations: [],
            craftGaps: [],
            citations: [],
          },
        },
      ],
    });
    const creative = blamed.candidates.filter(
      (row) => row.ruleId === PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
    );
    expect(creative.map((row) => row.entityId).sort()).toEqual(["ad-ok", "ad-weak"]);
    expect(creative.find((row) => row.entityId === "ad-weak")?.severity).toBe(
      "warning",
    );
    expect(creative.find((row) => row.entityId === "ad-ok")?.severity).toBe("info");
    expect(creative.find((row) => row.entityId === "ad-ok")?.recommendation).toMatch(
      /pixel/i,
    );
  });
});
