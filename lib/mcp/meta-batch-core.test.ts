import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batchStatusAfterRun, decideAtConfirm, planItem, writeBody, type MetaObjectState, type PlannedItem } from "./meta-batch-core";

const ACCOUNTS = new Map<string, string | null>([["act_111", "BRL"], ["act_222", "PYG"]]);
const USER = "00000000-0000-4000-8000-000000000001";

function object(overrides: Partial<MetaObjectState> = {}): MetaObjectState {
  return {
    id: "c1", name: "Vendas", accountId: "111", status: "ACTIVE", effectiveStatus: "ACTIVE",
    dailyBudget: "5000", lifetimeBudget: null, campaignId: null, adsetId: null,
    campaignDailyBudget: null, campaignLifetimeBudget: null, ...overrides,
  };
}

describe("planItem", () => {
  it("plans a pause with the state read as 'before'", () => {
    const item = planItem({ userId: USER, level: "campaign", id: "c1", action: "pause" }, object(), ACCOUNTS);
    assert.equal(item.plan, "run");
    assert.deepEqual(item.target, { status: "PAUSED" });
    assert.deepEqual(item.before, { status: "ACTIVE", dailyBudget: "5000" });
    assert.equal(item.accountId, "act_111");
  });

  it("skips what is already in the target state", () => {
    const item = planItem({ userId: USER, level: "campaign", id: "c1", action: "pause" }, object({ status: "PAUSED" }), ACCOUNTS);
    assert.equal(item.plan, "skip");
    assert.match(item.skipReason!, /pausado/);
  });

  it("refuses an object outside the client's ad accounts", () => {
    const item = planItem({ userId: USER, level: "campaign", id: "c1", action: "pause" }, object({ accountId: "999" }), ACCOUNTS);
    assert.equal(item.plan, "skip");
    assert.match(item.skipReason!, /conta de anúncio deste cliente/);
  });

  it("refuses a missing object and archived ones", () => {
    assert.equal(planItem({ userId: USER, level: "ad", id: "a1", action: "pause" }, undefined, ACCOUNTS).plan, "skip");
    assert.equal(planItem({ userId: USER, level: "ad", id: "a1", action: "activate" }, object({ status: "ARCHIVED" }), ACCOUNTS).plan, "skip");
  });

  it("warns when activating under a paused parent", () => {
    const item = planItem({ userId: USER, level: "adset", id: "s1", action: "activate" }, object({ status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" }), ACCOUNTS);
    assert.equal(item.plan, "run");
    assert.match(item.warning!, /nível acima/);
  });

  it("sets a campaign daily budget in minor units and flags large changes", () => {
    const item = planItem({ userId: USER, level: "campaign", id: "c1", action: "set_daily_budget", dailyBudget: 120 }, object(), ACCOUNTS);
    assert.equal(item.plan, "run");
    assert.deepEqual(item.target, { dailyBudget: "12000" });
    assert.match(item.warning!, /\+140%/);
    const small = planItem({ userId: USER, level: "campaign", id: "c1", action: "set_daily_budget", dailyBudget: 55.5 }, object(), ACCOUNTS);
    assert.deepEqual(small.target, { dailyBudget: "5550" });
    assert.equal(small.warning, undefined);
  });

  it("puts the budget where Meta keeps it (CBO on the campaign, ABO on the ad set)", () => {
    const abo = planItem({ userId: USER, level: "campaign", id: "c1", action: "set_daily_budget", dailyBudget: 60 }, object({ dailyBudget: null }), ACCOUNTS);
    assert.match(abo.skipReason!, /ABO/);
    const adsetUnderCbo = planItem(
      { userId: USER, level: "adset", id: "s1", action: "set_daily_budget", dailyBudget: 60 },
      object({ id: "s1", dailyBudget: null, campaignDailyBudget: "5000" }), ACCOUNTS,
    );
    assert.match(adsetUnderCbo.skipReason!, /CBO/);
    const adset = planItem(
      { userId: USER, level: "adset", id: "s1", action: "set_daily_budget", dailyBudget: 60 },
      object({ id: "s1", dailyBudget: "5000", campaignId: "c1" }), ACCOUNTS,
    );
    assert.equal(adset.plan, "run");
    assert.equal(adset.campaignId, "c1");
    assert.equal(adset.adsetId, "s1");
  });

  it("refuses budgets on ads, lifetime budgets, unchanged values and currencies without cents", () => {
    const run = (overrides: Partial<MetaObjectState>, dailyBudget = 60, level: "campaign" | "ad" = "campaign") =>
      planItem({ userId: USER, level, id: "c1", action: "set_daily_budget", dailyBudget }, object(overrides), ACCOUNTS);
    assert.match(run({}, 60, "ad").skipReason!, /Anúncio/);
    assert.match(run({ dailyBudget: null, lifetimeBudget: "100000" }).skipReason!, /total/);
    assert.match(run({}, 50).skipReason!, /Já está/);
    assert.match(run({ accountId: "222" }).skipReason!, /PYG/);
    assert.match(run({}, 0.5).skipReason!, /pelo menos/);
  });
});

describe("decideAtConfirm", () => {
  const planned = planItem({ userId: USER, level: "campaign", id: "c1", action: "pause" }, object(), ACCOUNTS) as PlannedItem;

  it("writes when the object is as the preview saw it", () => {
    assert.equal(decideAtConfirm(planned, object()), "write");
  });

  it("does nothing when it already reached the target (retry or someone did it)", () => {
    assert.equal(decideAtConfirm(planned, object({ status: "PAUSED" })), "already_applied");
  });

  it("does not overwrite a change made after the preview", () => {
    const budget = planItem({ userId: USER, level: "campaign", id: "c1", action: "set_daily_budget", dailyBudget: 60 }, object(), ACCOUNTS);
    assert.equal(decideAtConfirm(budget, object({ dailyBudget: "7000" })), "changed_since_preview");
    assert.equal(decideAtConfirm(budget, object({ dailyBudget: "6000" })), "already_applied");
    assert.equal(decideAtConfirm(planned, undefined), "missing");
  });

  it("builds the absolute write body", () => {
    assert.equal(writeBody(planned).toString(), "status=PAUSED");
  });
});

describe("batchStatusAfterRun", () => {
  it("is partial while a runnable item has no outcome", () => {
    const run = planItem({ userId: USER, level: "campaign", id: "c1", action: "pause" }, object(), ACCOUNTS);
    const skipped = planItem({ userId: USER, level: "campaign", id: "c2", action: "pause" }, undefined, ACCOUNTS);
    assert.equal(batchStatusAfterRun([run, skipped]), "partial");
    assert.equal(batchStatusAfterRun([{ ...run, outcome: "applied" }, skipped]), "done");
  });
});
