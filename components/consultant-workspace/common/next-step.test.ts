import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeJourney, type JourneyExtras } from "@/lib/consultant-workspace/journey";
import { emptyTotals, formatMoney, goalStatus, primaryKpi } from "@/lib/consultant-workspace/metrics";
import type { PerfTotals, WorkspaceAlert, WorkspaceClient, WorkspaceGoal, WorkspaceState } from "@/lib/consultant-workspace/types";
import { cleanRuleTitle, extraTags, nextStep, type NextStepAlert } from "./next-step";

const NOW = new Date("2026-10-13T15:00:00Z").getTime();

function totals(partial: Partial<PerfTotals> = {}): PerfTotals {
  return { ...emptyTotals(), ...partial };
}

type ClientOptions = {
  spend?: number;
  purchases?: number;
  value?: number;
  previousSpend?: number;
  health?: WorkspaceClient["meta"]["health"];
  holds?: number;
  status?: string;
};

function client(options: ClientOptions = {}): WorkspaceClient {
  const current = totals({ spend: options.spend ?? 0, purchases: options.purchases ?? 0, purchaseValue: options.value ?? 0 });
  const previous = totals({ spend: options.previousSpend ?? 0 });
  return {
    userId: "u1",
    email: "dono@restaurante.com",
    name: "Ana Souza",
    companyName: "Burger da Ana",
    displayName: "Burger da Ana",
    phone: "11999998888",
    plan: { tier: "pro", period: "monthly", status: options.status ?? "active", provider: "stripe", renewalAt: null, startedAt: null, customerSince: null },
    accessUntil: null,
    access: "pagante",
    consultant: { key: null, name: null, email: null },
    meta: { health: options.health ?? "ok", detail: null, accountName: null, hasActiveManagedCampaign: false, checkedAt: null },
    publishHolds: options.holds ?? 0,
    perf: {
      current,
      previous,
      kpi: primaryKpi(current, "compras"),
      previousKpi: primaryKpi(previous, "compras"),
      series: [],
      monthToDateSpend: 0,
      activeCampaigns: 0,
    },
    alerts: { open: 0, critical: 0, warning: 0, info: 0, oldestOpenAt: null },
    lastConsultantTouchAt: null,
  };
}

function extras(partial: Partial<JourneyExtras> = {}): JourneyExtras {
  return {
    userId: "u1",
    signupAt: "2026-07-08T12:00:00Z",
    companyOnboardingCompleted: true,
    certification: null,
    hasCampaign: false,
    firstSpendDate: null,
    lastSpendDate: null,
    crmStatus: null,
    ...partial,
  };
}

function emptyStore(partial: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    goals: {},
    notes: [],
    alertActions: {},
    simulatedActions: [],
    assignments: {},
    handoffs: {},
    tasks: [],
    clientTags: {},
    dismissedAutoTags: {},
    sentMessages: [],
    aiAnalyses: {},
    ...partial,
  };
}

function alert(ruleId: string, severity: WorkspaceAlert["severity"] = "warning"): WorkspaceAlert {
  return {
    id: `a-${ruleId}`,
    userId: "u1",
    ruleId,
    ruleTitle: ruleId === "playbook.campaign_stalled" ? "Campanha parada (consultor)" : ruleId,
    family: ruleId.startsWith("account.") ? "account" : "playbook",
    severity,
    title: ruleId,
    evidence: "",
    recommendation: "",
    entityLevel: "campaign",
    entityId: "",
    entityName: null,
    actionType: "",
    metrics: {},
    createdAt: "2026-10-12T10:00:00Z",
  };
}

function run(
  c: WorkspaceClient,
  e: JourneyExtras,
  options: { alerts?: WorkspaceAlert[]; goal?: WorkspaceGoal; store?: WorkspaceState; stopped?: { weekSpend: number } | null } = {},
) {
  const store = options.store ?? emptyStore(options.goal ? { goals: { u1: options.goal } } : {});
  const alerts = options.alerts ?? [];
  const journey = computeJourney(c, e, store, alerts, goalStatus(c.perf.kpi, options.goal).status, NOW);
  const result = nextStep(c, journey, {
    alerts: alerts as NextStepAlert[],
    stopped: options.stopped,
    goal: options.goal ?? null,
  });
  return { journey, result };
}

const running = extras({ hasCampaign: true, firstSpendDate: "2026-07-16", lastSpendDate: "2026-10-12" });

describe("nextStep — onboarding: a ação do passo que trava", () => {
  it("sem Meta conectada → Conectar o Facebook (neutro)", () => {
    const { result } = run(client({ health: "sem_meta" }), extras());
    assert.equal(result?.text, "Conectar o Facebook");
    assert.equal(result?.tone, "neutral");
    assert.deepEqual(result?.covers, ["sem_meta"]);
  });

  it("token caiu → Reconectar o Facebook (crítico)", () => {
    const { result } = run(client({ health: "token_invalido" }), extras());
    assert.equal(result?.text, "Reconectar o Facebook");
    assert.equal(result?.tone, "critical");
  });

  it("erro de não discriminação → Liberar a conta na Meta (crítico)", () => {
    const { result } = run(client(), extras({ certification: "certification_required" }));
    assert.equal(result?.text, "Liberar a conta na Meta (não discriminação)");
    assert.equal(result?.tone, "critical");
    assert.ok(result?.covers.includes("certificacao_meta"));
  });

  it("publicação retida também trava a conta", () => {
    const { result } = run(client({ holds: 2 }), extras({ hasCampaign: true }));
    assert.equal(result?.text, "Liberar a conta na Meta (não discriminação)");
  });

  it("sem campanha → Publicar a 1ª campanha", () => {
    const { result } = run(client(), extras());
    assert.equal(result?.text, "Publicar a 1ª campanha");
    assert.equal(result?.tone, "neutral");
  });

  it("campanha publicada sem gasto → Esperar a 1ª veiculação", () => {
    const { result } = run(client(), extras({ hasCampaign: true }));
    assert.equal(result?.text, "Esperar a 1ª veiculação");
  });
});

describe("nextStep — rodando", () => {
  it("saudável → nada", () => {
    const { result } = run(client({ spend: 300, purchases: 20, value: 1500 }), running);
    assert.equal(result, null);
  });

  it("gastando sem resultado → crítico", () => {
    const { result } = run(client({ spend: 300 }), running);
    assert.equal(result?.text, "Gastando sem resultado — checar pixel e criativo");
    assert.equal(result?.tone, "critical");
    assert.ok(result?.covers.includes("sem_resultado"));
  });

  it("Facebook desconectado vem antes de tudo", () => {
    const { result } = run(client({ spend: 300, health: "token_invalido" }), running);
    assert.equal(result?.text, "Reconectar o Facebook");
    assert.equal(result?.tone, "critical");
  });

  it("diagnóstico de criativo → Trocar criativo com o custo (atenção)", () => {
    const c = client({ spend: 338.6, purchases: 20 });
    const { result } = run(c, running, { alerts: [alert("playbook.creative_diagnosis")] });
    assert.equal(result?.text, `Trocar criativo — CPA ${formatMoney(c.perf.kpi.cost)}`);
    assert.equal(result?.tone, "attention");
    assert.deepEqual(result?.covers, ["criativos"]);
  });

  it("alerta só informativo não vira ação", () => {
    const { result } = run(client({ spend: 300, purchases: 20 }), running, {
      alerts: [alert("playbook.campaign_stalled", "info")],
    });
    assert.equal(result, null);
  });

  it("fora da meta de custo → CPA acima da meta", () => {
    const c = client({ spend: 300, purchases: 10 });
    const goal: WorkspaceGoal = { kpi: "cpa", target: 15, monthlyBudget: null };
    const { result } = run(c, running, { goal });
    assert.equal(result?.text, `CPA acima da meta — ${formatMoney(30)}`);
    assert.equal(result?.tone, "attention");
  });

  it("fora da meta de ROAS → ROAS abaixo da meta", () => {
    const c = client({ spend: 300, purchases: 10, value: 450 });
    const goal: WorkspaceGoal = { kpi: "roas", target: 4, monthlyBudget: null };
    const { result } = run(c, running, { goal });
    assert.equal(result?.text, "ROAS abaixo da meta — 1,50x");
  });

  it("alerta sem ação mapeada usa o título da regra, sem o sufixo", () => {
    const { result } = run(client({ spend: 300, purchases: 20 }), running, {
      alerts: [{ ...alert("playbook.nova_regra"), ruleTitle: "Regra nova (consultor)" }],
    });
    assert.equal(result?.text, "Regra nova");
    assert.equal(result?.tone, "attention");
  });

  it("ROAS validado aberto → Pronta para escalar", () => {
    const { result } = run(client({ spend: 300, purchases: 20, value: 1800 }), running, {
      alerts: [alert("playbook.roas_scale", "info")],
    });
    assert.equal(result?.text, "Pronta para escalar — ROAS 6,00x");
    assert.equal(result?.tone, "neutral");
  });

  it("problema vence a oportunidade de escala", () => {
    const { result } = run(client({ spend: 300 }), running, { alerts: [alert("playbook.roas_scale", "info")] });
    assert.equal(result?.tone, "critical");
  });
});

describe("nextStep — parado", () => {
  const stoppedExtras = extras({ hasCampaign: true, firstSpendDate: "2026-05-01", lastSpendDate: "2026-08-24" });

  it("com dinheiro parado → Reativar com quanto rodava (crítico)", () => {
    const { journey, result } = run(client(), stoppedExtras, { stopped: { weekSpend: 2079.4 } });
    assert.equal(journey.stage, "parado");
    assert.equal(result?.text, `Reativar — rodava ${formatMoney(2079.4, false)}/semana`);
    assert.equal(result?.tone, "critical");
  });

  it("sem leitura do gasto parado, mas gastou no período anterior → crítico", () => {
    const { result } = run(client({ previousSpend: 500 }), stoppedExtras, { stopped: null });
    assert.equal(result?.text, `Reativar — gastou ${formatMoney(500, false)} no período anterior`);
    assert.equal(result?.tone, "critical");
  });

  it("sem dinheiro em jogo → neutro", () => {
    const { result } = run(client(), stoppedExtras, { stopped: { weekSpend: 0 } });
    assert.equal(result?.text, "Reativar as campanhas");
    assert.equal(result?.tone, "neutral");
  });

  it("Facebook desconectado mantém o dinheiro na frase", () => {
    const { result } = run(client({ health: "token_invalido" }), stoppedExtras, { stopped: { weekSpend: 700 } });
    assert.equal(result?.text, `Reconectar o Facebook — rodava ${formatMoney(700, false)}/semana`);
    assert.equal(result?.tone, "critical");
  });
});

describe("extraTags e cleanRuleTitle", () => {
  it("tira as tags que a frase já cobre", () => {
    const tags = [{ key: "sem_meta" }, { key: "cliente_sumido" }];
    assert.deepEqual(
      extraTags(tags, { text: "Conectar o Facebook", tone: "neutral", covers: ["sem_meta"] }).map((tag) => tag.key),
      ["cliente_sumido"],
    );
    assert.equal(extraTags(tags, null).length, 2);
  });

  it("limpa o sufixo do público", () => {
    assert.equal(cleanRuleTitle("Campanha parada (consultor)"), "Campanha parada");
    assert.equal(cleanRuleTitle("ROAS em queda"), "ROAS em queda");
  });
});
