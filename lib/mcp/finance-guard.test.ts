import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { campaignMetricsFor } from "./finance-guard";

const actor = (role: BackofficeActor["role"], email: string): BackofficeActor => ({ id: `${role}-id`, email, role, source: "database" });
const metrics = { total: 100, sent: 95, delivered: 90, read: 70, failed: 5, tracked_clicks: 12, trials: 4, paying: 2, windowDays: 7, revenue_centavos: 39_800 };

describe("campaign revenue over MCP", () => {
  it("shows the revenue only with the Financeiro gate (role and e-mail list)", () => {
    const out = campaignMetricsFor(actor("admin", "joaopedro@layback.trade"), metrics);
    assert.equal("revenueReais" in out ? out.revenueReais : null, 398);
  });

  it("hides it from a dev, and from an admin outside the Financeiro list", () => {
    for (const who of [actor("dev", "dev@automatize.com"), actor("admin", "admin@automatize.com"), actor("dev", "joaopedro@layback.trade")]) {
      const out = campaignMetricsFor(who, metrics);
      assert.ok(!("revenue_centavos" in out) && !("revenueReais" in out), `${who.role} ${who.email}`);
      assert.equal(out.revenue, "restrito ao Financeiro");
      assert.equal(JSON.stringify(out).includes("398"), false);
      assert.equal(out.paying, 2, "counts stay: they are campaign results, not money");
    }
  });

  it("passes only known fields, so a money column added later does not leak", () => {
    const withExtra = { ...metrics, mrr_centavos: 1_000_000, payment_amount: 19_900 } as typeof metrics;
    const out = campaignMetricsFor(actor("dev", "dev@automatize.com"), withExtra);
    assert.equal(JSON.stringify(out).includes("1000000") || JSON.stringify(out).includes("19900"), false);
    assert.deepEqual(Object.keys(out).sort(), ["delivered", "failed", "paying", "read", "revenue", "sent", "total", "trackedClicks", "trials", "windowDays"]);
  });
});
