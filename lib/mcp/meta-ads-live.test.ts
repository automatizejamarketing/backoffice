import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { ensureMetaTestEnv, graphErrorBody, installMetaFetchStub } from "../../tests/helpers/meta-fetch-stub";

ensureMetaTestEnv();
mock.module("server-only", () => ({}));
mock.module("@/lib/meta-business/get-user-access-token", () => ({
  getUserAccessTokenByUserId: async (userId: string) => userId === "no-meta"
    ? { success: false, error: { message: "A conexão com o Facebook expirou." } }
    : { success: true, userId, accessToken: `token-${userId}`, connection: { tokenKind: "user", name: "Conexão" } },
}));

const ACCOUNTS = [
  { id: "act_111", account_id: "111", name: "Loja", currency: "BRL" },
  { id: "act_222", account_id: "222", name: "Bloqueada", currency: "BRL" },
];

let getClientCampaigns: typeof import("./meta-ads-live").getClientCampaigns;
before(async () => {
  ({ getClientCampaigns } = await import("./meta-ads-live"));
});

const periods = {
  current: { since: "2026-10-01", until: "2026-10-07" },
  previous: { since: "2026-09-24", until: "2026-09-30" },
  days: 7, includesToday: false,
};
const sales = (spend: string, purchases: string, value: string) => ({
  objective: "OUTCOME_SALES", spend,
  actions: [{ action_type: "purchase", value: purchases }],
  action_values: [{ action_type: "purchase", value }],
  cost_per_action_type: [{ action_type: "purchase", value: String(Number(spend) / Number(purchases)) }],
});

describe("getClientCampaigns", () => {
  it("keeps the healthy account when another account fails, and merges both periods", async () => {
    const stub = installMetaFetchStub(req => {
      if (req.path === "me") return { body: { id: "me" } };
      if (req.path === "me/adaccounts") return { body: { data: ACCOUNTS } };
      if (req.path.startsWith("act_222/")) return { status: 400, body: graphErrorBody({ message: "Ad account disabled", code: 100 }) };
      if (req.path === "act_111/campaigns") return { body: { data: [
        { id: "c1", name: "Vendas", objective: "OUTCOME_SALES", daily_budget: "5000" },
        { id: "c3", name: "Nova", objective: "OUTCOME_LEADS", daily_budget: "2000" },
      ] } };
      if (req.path === "act_111/insights") {
        const current = req.params.get("time_range")?.includes("2026-10-01");
        return { body: { data: current
          ? [{ campaign_id: "c1", campaign_name: "Vendas", ...sales("300", "6", "900") }]
          : [{ campaign_id: "c1", campaign_name: "Vendas", ...sales("200", "8", "800") }, { campaign_id: "c2", campaign_name: "Parou", ...sales("50", "1", "40") }] } };
      }
      return undefined;
    });
    try {
      const result = await getClientCampaigns({ userId: "client-1", level: "campaign", periods, spendByAccount: new Map() });
      assert.deepEqual(result.accounts.map(a => [a.id, a.spend, "error" in a]), [["act_111", 300, false], ["act_222", 0, true]]);
      const byId = new Map(result.rows.map(r => [r.id, r]));
      const c1 = byId.get("c1")!;
      assert.equal(c1.active, true);
      assert.equal(c1.dailyBudget, 50);
      assert.equal(c1.result?.count, 6);
      assert.equal(c1.roas, 3);
      assert.deepEqual(c1.change, { spend: 50, results: -25, costPerResult: 100, roas: -25 });
      assert.equal(byId.get("c2")?.spend, 0, "campaign that only spent last period is listed");
      assert.equal(byId.get("c2")?.active, false);
      assert.equal(byId.get("c3")?.active, true, "active campaign without spend is listed");
      assert.equal(c1.account, "Loja");
      // Read-only: every Graph call is a GET.
      assert.ok(stub.calls.every(c => c.method === "GET"));
    } finally {
      stub.restore();
    }
  });

  it("follows the active-campaign pages and reads ROAS 0 when sales stop", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `C${i}`, daily_budget: "1000" }));
    const stub = installMetaFetchStub(req => {
      if (req.path === "me") return { body: { id: "me" } };
      if (req.path === "me/adaccounts") return { body: { data: [ACCOUNTS[0]] } };
      if (req.path === "act_111/campaigns") return req.params.get("after")
        ? { body: { data: [{ id: "c9", name: "Pagina 2", daily_budget: "3000" }] } }
        : { body: { data: page1, paging: { cursors: { after: "next" }, next: "https://graph.facebook.com/next" } } };
      if (req.path === "act_111/insights") {
        const current = req.params.get("time_range")?.includes("2026-10-01");
        return { body: { data: [{ campaign_id: "c9", campaign_name: "Pagina 2", objective: "OUTCOME_SALES", spend: current ? "100" : "100", ...(current ? {} : { actions: [{ action_type: "purchase", value: "2" }], action_values: [{ action_type: "purchase", value: "300" }] }) }] } };
      }
      return undefined;
    });
    try {
      const result = await getClientCampaigns({ userId: "client-3", level: "campaign", periods, spendByAccount: new Map() });
      const c9 = result.rows.find(r => r.id === "c9")!;
      assert.equal(c9.active, true);
      assert.equal(c9.dailyBudget, 30);
      assert.equal(c9.roas, 0);
      assert.equal(c9.change.roas, -100);
      assert.equal(result.rows.length, 101);
    } finally {
      stub.restore();
    }
  });

  it("refuses an ad account the client did not grant and explains a missing connection", async () => {
    const stub = installMetaFetchStub(req => (req.path === "me" ? { body: { id: "me" } } : req.path === "me/adaccounts" ? { body: { data: ACCOUNTS } } : undefined));
    try {
      await assert.rejects(getClientCampaigns({ userId: "client-2", level: "campaign", periods, spendByAccount: new Map(), adAccountId: "999" }), /não está concedida/);
      assert.ok(stub.calls.every(c => !c.path.startsWith("act_")), "no read of an account the client does not own");
    } finally {
      stub.restore();
    }
    await assert.rejects(getClientCampaigns({ userId: "no-meta", level: "campaign", periods, spendByAccount: new Map() }), /expirou/);
  });
});
