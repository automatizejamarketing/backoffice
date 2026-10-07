import { describe, expect, test } from "bun:test";
import {
  labelCandidatesByAccount,
  pickPlaybookAccounts,
  PLAYBOOK_MAX_ACCOUNTS_PER_USER,
} from "./multi-account";
import type { PlaybookInsightCandidate } from "./types";

const ca01 = { id: "act_4282062908742907", account_id: "4282062908742907", name: "CA 01 - Alpina Burguer" };
const ca02 = { id: "act_1063291159876070", account_id: "1063291159876070", name: "CA 02 - Alpina Burguer" };

function candidate(over: Partial<PlaybookInsightCandidate>): PlaybookInsightCandidate {
  return {
    ruleId: "playbook.roas_scale",
    severity: "info",
    confidence: "high",
    entityLevel: "campaign",
    entityId: "c1",
    entityName: "Campanha",
    actionType: "scale_or_extend",
    title: "t",
    evidence: "Evidência.",
    recommendation: "r",
    metrics: {},
    ...over,
  };
}

describe("pickPlaybookAccounts", () => {
  test("Alpina: every enabled account, principal first (Meta lists CA 01 first)", () => {
    const accounts = pickPlaybookAccounts({
      visible: [ca01, ca02],
      enabledIds: ["1063291159876070", "4282062908742907"],
    });
    expect(accounts.map((account) => account.accountId)).toEqual([ca02.id, ca01.id]);
  });

  test("no selection keeps the old first-account behaviour", () => {
    const accounts = pickPlaybookAccounts({ visible: [ca01, ca02], enabledIds: [] });
    expect(accounts.map((account) => account.accountId)).toEqual([ca01.id]);
  });

  test("selection none of which is visible keeps the first account", () => {
    const accounts = pickPlaybookAccounts({ visible: [ca01], enabledIds: ["777"] });
    expect(accounts.map((account) => account.accountId)).toEqual([ca01.id]);
  });

  test("caps the accounts per user", () => {
    const visible = Array.from({ length: 8 }, (_, i) => ({ id: `act_${i}`, account_id: `${i}` }));
    const accounts = pickPlaybookAccounts({
      visible,
      enabledIds: visible.map((account) => account.account_id),
    });
    expect(accounts).toHaveLength(PLAYBOOK_MAX_ACCOUNTS_PER_USER);
  });

  test("no visible account means nothing to evaluate", () => {
    expect(pickPlaybookAccounts({ visible: [], enabledIds: ["1"] })).toEqual([]);
  });
});

describe("labelCandidatesByAccount", () => {
  const accountByCampaignId = new Map([
    ["c1", { accountId: ca01.id, name: ca01.name }],
    ["c2", { accountId: ca02.id, name: ca02.name }],
  ]);

  test("stamps campaign and ad candidates with their account and names it in the evidence", () => {
    const result = labelCandidatesByAccount({
      evaluation: {
        accountId: ca02.id,
        campaigns: [],
        candidates: [
          candidate({ entityId: "c1" }),
          candidate({
            ruleId: "playbook.creative_diagnosis",
            entityLevel: "ad",
            entityId: "ad9",
            metrics: { campaignId: "c2" },
          }),
          candidate({ entityLevel: "ad", entityId: "ad10", metrics: { campaignId: "unknown" } }),
        ],
      },
      accountByCampaignId,
      multipleAccounts: true,
    });

    const [first, second, third] = result.candidates;
    expect(first?.metrics.accountId).toBe(ca01.id);
    expect(first?.evidence).toBe("Evidência. Conta: CA 01 - Alpina Burguer.");
    expect(second?.metrics).toMatchObject({ accountId: ca02.id, accountName: ca02.name, campaignId: "c2" });
    expect(third?.evidence).toBe("Evidência.");
    expect(third?.metrics.accountId).toBeUndefined();
  });

  test("a single account gets the id but keeps the evidence as it was", () => {
    const result = labelCandidatesByAccount({
      evaluation: { accountId: ca01.id, campaigns: [], candidates: [candidate({ entityId: "c1" })] },
      accountByCampaignId,
      multipleAccounts: false,
    });
    expect(result.candidates[0]?.evidence).toBe("Evidência.");
    expect(result.candidates[0]?.metrics.accountId).toBe(ca01.id);
  });
});
