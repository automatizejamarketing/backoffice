import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { alertEvidenceFor, campaignMetricsFor } from "./finance-guard";

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

describe("alert evidence over MCP", () => {
  const dev = actor("dev", "dev@automatize.com");
  const consultant = actor("marketing_consultant", "ana@automatize.com");
  const finance = actor("admin", "joaopedro@layback.trade");
  const restricted = "Assinatura Stripe past_due com cobrança no cartão que não passou. Motivo restrito ao Financeiro.";

  it("replaces the provider's free-text reason as a whole, in digits or spelled out", () => {
    for (const reason of ["Falha na cobrança de R$ 199,00", "Falha na cobrança de cento e noventa e nove reais", "amount 19900 BRL declined"]) {
      const evidence = `Assinatura Stripe past_due. Última falha: ${reason}.`;
      assert.equal(alertEvidenceFor(dev, "account.card_payment_failed", evidence), restricted);
      assert.equal(alertEvidenceFor(consultant, "account.card_payment_failed", evidence), restricted);
    }
    assert.equal(
      alertEvidenceFor(dev, "account.card_payment_failed", "Assinatura Vindi unpaid com cobrança no cartão que não passou."),
      "Assinatura Vindi unpaid com cobrança no cartão que não passou. Motivo restrito ao Financeiro.",
    );
  });

  it("keeps the text for Financeiro and for alerts without free text", () => {
    const evidence = "Assinatura Stripe past_due. Última falha: Falha na cobrança de R$ 199,00.";
    assert.equal(alertEvidenceFor(finance, "account.card_payment_failed", evidence), evidence);
    const adAlert = "Gasto de R$ 1.234,56 sem resultado nos últimos 3 dias.";
    assert.equal(alertEvidenceFor(dev, "playbook.spend_no_result", adAlert), adAlert);
    const pix = "Último pagamento foi PIX e o acesso vence em 3 dias. PIX não renova sozinho.";
    assert.equal(alertEvidenceFor(dev, "account.pix_expiring", pix), pix);
  });
});
