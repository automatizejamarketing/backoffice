import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canMoveTo, crmHealth, crmOwnerByEmail, crmPlacement, planStatus } from "./crm";

const now = new Date("2026-10-16T12:00:00Z").getTime();
const day = 86_400_000;
const inDays = (days: number) => new Date(now + days * day).toISOString();

describe("coluna do CRM", () => {
  const base = { access: "pagante" as const, assignedEmail: null, stage: "rodando" as const, tier: "starter" as const };

  it("sem responsável: onboarding → Fred, Premium → Comelli, resto → Lucas", () => {
    assert.deepEqual(crmPlacement({ ...base, stage: "onboarding" }), { owner: "fred", reason: "auto" });
    assert.deepEqual(crmPlacement({ ...base, tier: "premium" }), { owner: "comelli", reason: "auto" });
    assert.deepEqual(crmPlacement(base), { owner: "lucas", reason: "auto" });
  });

  it("responsável salvo vale, se for do CRM", () => {
    assert.deepEqual(crmPlacement({ ...base, assignedEmail: "Comelliworking@gmail.com" }), { owner: "comelli", reason: "salvo" });
    assert.deepEqual(crmPlacement({ ...base, assignedEmail: "outro@x.com" }), { owner: "lucas", reason: "auto" });
  });

  it("vencido, atrasado ou cancelado vai para o Gui mesmo com outro responsável", () => {
    for (const access of ["expirado", "inadimplente", "cancelado"] as const) {
      assert.deepEqual(crmPlacement({ ...base, access, assignedEmail: "lucashaddadm@gmail.com" }), { owner: "gui", reason: "acesso" });
      assert.equal(canMoveTo(access, "lucas"), false);
      assert.equal(canMoveTo(access, "gui"), true);
    }
    assert.equal(canMoveTo("trial", "comelli"), true);
  });

  it("acha o responsável pelo login", () => {
    assert.equal(crmOwnerByEmail("barretonovaes.vilas@gmail.com")?.key, "gui");
    assert.equal(crmOwnerByEmail(null), null);
  });
});

describe("card", () => {
  const plan = { startedAt: inDays(-3), customerSince: inDays(-120), renewalAt: inDays(27) };

  it("situação do plano e datas", () => {
    assert.equal(planStatus({ access: "pagante", accessUntil: inDays(27), plan }, now).label, "Ativo · em dia");
    assert.match(planStatus({ access: "trial", accessUntil: inDays(4), plan }, now).dates ?? "", /^trial desde 13\/10 · vence 20\/10$/);
    assert.equal(planStatus({ access: "expirado", accessUntil: inDays(-5), plan }, now).label, "Expirado há 5 dias");
    assert.equal(planStatus({ access: "inadimplente", accessUntil: inDays(-2), plan }, now).tone, "bad");
  });

  it("estágio: regularizar > erro > parado > onboarding > recomendação > ok", () => {
    const ok = { access: "pagante" as const, stage: "rodando" as const, metaBroken: false, publishHolds: 0, criticalStep: false, matRecommendations: 0 };
    assert.equal(crmHealth(ok), "ok");
    assert.equal(crmHealth({ ...ok, matRecommendations: 2 }), "recomendacao");
    assert.equal(crmHealth({ ...ok, stage: "parado", matRecommendations: 2 }), "parado");
    assert.equal(crmHealth({ ...ok, stage: "parado", metaBroken: true }), "erro");
    assert.equal(crmHealth({ ...ok, access: "expirado", metaBroken: true }), "regularizar");
  });
});
