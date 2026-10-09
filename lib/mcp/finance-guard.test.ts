import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { alertTextFor, campaignMetricsFor } from "./finance-guard";

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

describe("alert texts over MCP", () => {
  const dev = actor("dev", "dev@automatize.com");
  const finance = actor("admin", "joaopedro@layback.trade");
  const failed = "Assinatura Stripe past_due. Última falha: Falha na cobrança de R$ 199,00.";

  it("masks amounts in subscription alerts for whoever lacks Financeiro access", () => {
    const out = alertTextFor(dev, "account.card_payment_failed", failed);
    assert.equal(out.includes("199"), false);
    assert.equal(out, "Assinatura Stripe past_due. Última falha: Falha na cobrança de R$ •••.");
    assert.equal(alertTextFor(dev, "account.card_payment_failed", "Última falha: amount 19900 BRL declined"), "Última falha: amount ••• BRL declined");
  });

  it("keeps the text for Financeiro and for the client's own ad money", () => {
    assert.equal(alertTextFor(finance, "account.card_payment_failed", failed), failed);
    const adAlert = "Gasto de R$ 1.234,56 sem resultado nos últimos 3 dias.";
    assert.equal(alertTextFor(dev, "playbook.spend_no_result", adAlert), adAlert);
    const pix = "Último pagamento foi PIX e o acesso vence em 3 dias. PIX não renova sozinho.";
    assert.equal(alertTextFor(dev, "account.pix_expiring", pix), pix, "fixed sentences carry no amount");
  });
});
