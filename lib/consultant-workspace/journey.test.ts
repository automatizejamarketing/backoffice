import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeJourney, MESSAGE_TEMPLATES, PROBLEM_TAG_BY_KEY, renderTemplate, type JourneyExtras } from "./journey";
import { budgetPacing, emptyTotals, goalStatus, primaryKpi, workspaceRange } from "./metrics";
import type { PerfTotals, WorkspaceClient, WorkspaceState } from "./types";

const range = workspaceRange(7, new Date("2026-10-13T15:00:00Z"));

function totals(partial: Partial<PerfTotals> = {}): PerfTotals {
  return { ...emptyTotals(), ...partial };
}

function client(overrides: { spend?: number; purchases?: number; health?: WorkspaceClient["meta"]["health"]; holds?: number } = {}): WorkspaceClient {
  const current = totals({ spend: overrides.spend ?? 0, purchases: overrides.purchases ?? 0 });
  return {
    userId: "u1",
    email: "dono@restaurante.com",
    name: "Ana Souza",
    companyName: "Burger da Ana",
    displayName: "Burger da Ana",
    phone: "11999998888",
    plan: { tier: "premium", period: "monthly", status: "active", provider: "stripe", renewalAt: null },
    accessUntil: null,
    consultant: { key: null, name: null, email: null },
    meta: { health: overrides.health ?? "ok", detail: null, accountName: null, hasActiveManagedCampaign: false, checkedAt: null },
    publishHolds: overrides.holds ?? 0,
    perf: {
      current,
      previous: totals(),
      kpi: primaryKpi(current, "compras"),
      previousKpi: primaryKpi(totals(), "compras"),
      series: [],
      monthToDateSpend: 0,
      activeCampaigns: 0,
    },
    alerts: { open: 0, critical: 0, warning: 0, info: 0, oldestOpenAt: null },
    lastConsultantTouchAt: null,
  };
}

const emptyState: WorkspaceState = {
  goals: {}, notes: [], alertActions: {}, simulatedActions: [], assignments: {},
  handoffs: {}, clientTags: {}, dismissedAutoTags: {}, sentMessages: [], aiAnalyses: {},
};

const extras = (partial: Partial<JourneyExtras> = {}): JourneyExtras => ({
  userId: "u1", signupAt: "2026-10-01T12:00:00Z", companyOnboardingCompleted: true, certification: "ok",
  hasCampaign: false, firstSpendDate: null, lastSpendDate: null, crmStatus: null, ...partial,
});

describe("jornada do cliente", () => {
  it("fica no onboarding, travada no Facebook, enquanto não conecta a Meta", () => {
    const journey = computeJourney(client({ health: "sem_meta" }), extras(), emptyState, [], "sem_meta");
    assert.equal(journey.stage, "onboarding");
    assert.equal(journey.blocker?.key, "meta");
    assert.ok(journey.autoTags.includes("sem_meta"));
  });

  it("detecta o erro de não discriminação pela certificação ou por anúncio retido", () => {
    const byCertification = computeJourney(client(), extras({ certification: "certification_required" }), emptyState, [], "sem_meta");
    assert.equal(byCertification.blocker?.key, "certificacao");
    assert.ok(byCertification.tags.some((tag) => tag.key === "certificacao_meta"));
    const byHold = computeJourney(client({ holds: 2 }), extras(), emptyState, [], "sem_meta");
    assert.ok(byHold.autoTags.includes("certificacao_meta"));
  });

  it("passa a rodando com gasto no período e a parado quando o gasto some", () => {
    assert.equal(computeJourney(client({ spend: 100, purchases: 5 }), extras({ firstSpendDate: "2026-09-20" }), emptyState, [], "sem_meta").stage, "rodando");
    assert.equal(computeJourney(client(), extras({ firstSpendDate: "2026-09-20", lastSpendDate: "2026-10-01" }), emptyState, [], "sem_meta").stage, "parado");
  });

  it("marca atenção quando gasta sem resultado e respeita a tag descartada", () => {
    const state = { ...emptyState, dismissedAutoTags: { u1: ["sem_resultado"] } };
    const journey = computeJourney(client({ spend: 300 }), extras({ firstSpendDate: "2026-09-20" }), state, [], "sem_meta");
    assert.ok(journey.attentionReasons.includes("Gastando sem resultado"));
    assert.ok(!journey.autoTags.includes("sem_resultado"));
  });

  it("toda tag com mensagem sugerida aponta para um template que existe", () => {
    const keys = new Set(MESSAGE_TEMPLATES.map((template) => template.key));
    for (const tag of PROBLEM_TAG_BY_KEY.values()) if (tag.templateKey) assert.ok(keys.has(tag.templateKey), tag.key);
  });

  it("preenche a mensagem com os dados do cliente e deixa o que falta entre colchetes", () => {
    const text = renderTemplate(MESSAGE_TEMPLATES.find((t) => t.key === "resumo_semanal")!, client({ spend: 412, purchases: 98 }));
    assert.match(text, /Burger da Ana/);
    assert.match(text, /98 compras/);
    assert.match(text, /\[o que você vai fazer\]/);
  });
});

describe("meta e ritmo de verba", () => {
  it("compara custo com a meta: até 10% acima é perto", () => {
    const kpi = primaryKpi(totals({ spend: 105, purchases: 10 }), "compras");
    assert.equal(goalStatus(kpi, { kpi: "cpa", target: 12, monthlyBudget: null }).status, "na_meta");
    assert.equal(goalStatus(kpi, { kpi: "cpa", target: 10, monthlyBudget: null }).status, "perto");
    assert.equal(goalStatus(kpi, { kpi: "cpa", target: 8, monthlyBudget: null }).status, "fora");
    assert.equal(goalStatus(kpi, undefined).status, "sem_meta");
  });

  it("mede ROAS como mínimo", () => {
    const kpi = primaryKpi(totals({ spend: 100, purchases: 4, purchaseValue: 250 }), "compras");
    assert.equal(goalStatus(kpi, { kpi: "roas", target: 2, monthlyBudget: null }).status, "na_meta");
    assert.equal(goalStatus(kpi, { kpi: "roas", target: 4, monthlyBudget: null }).status, "fora");
  });

  it("projeta o mês a partir do gasto até ontem", () => {
    const pacing = budgetPacing(1200, 3100, range)!;
    assert.equal(range.to, "2026-10-12");
    assert.equal(Math.round(pacing.expected), 1200);
    assert.equal(Math.round(pacing.projected), 3100);
    assert.equal(budgetPacing(100, null, range), null);
  });
});
