import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyTotals, primaryKpi } from "./metrics";
import { OUTREACH_MESSAGE_MAX, OUTREACH_TITLE_MAX, outreachInputSchema } from "./outreach-core";
import {
  balanceSuggestion,
  blendedCost,
  creativeBadSuggestions,
  evaluateBalance,
  evaluatePixel,
  firstNameOf,
  metaBillingSettingsUrl,
  pixelSuggestion,
  scaleSuggestions,
  type AdPerformance,
  type BalanceCheckInput,
  type MatDraft,
  type PixelReading,
} from "./playbook-actions";
import type { PerfTotals, PrimaryKpi, WorkspaceAlert } from "./types";

const ctx = { firstName: "Ana" };
const USER = "4f6c1a52-3a3e-4f1f-9a51-0d2b6c7e8f90";

function alert(partial: Partial<WorkspaceAlert>): WorkspaceAlert {
  return {
    id: partial.id ?? "i1",
    userId: USER,
    ruleId: "playbook.roas_scale",
    ruleTitle: "ROAS validado",
    family: "playbook",
    severity: "info",
    title: "",
    evidence: "",
    recommendation: "",
    entityLevel: "campaign",
    entityId: "120000000000001",
    entityName: "Delivery Pizza",
    actionType: "scale_or_extend",
    metrics: {},
    createdAt: "2026-10-12T10:00:00.000Z",
    ...partial,
  };
}

function ad(
  adId: string,
  current: Partial<PerfTotals>,
  options: { share?: number; kind?: PrimaryKpi["kind"]; status?: string | null; name?: string } = {},
): AdPerformance {
  const totals = { ...emptyTotals(), ...current };
  return {
    adId,
    name: options.name ?? `Anúncio ${adId}`,
    campaignName: "Vendas",
    status: options.status ?? "ACTIVE",
    current: totals,
    kpi: primaryKpi(totals, options.kind ?? "compras"),
    spendShare: options.share ?? 0.25,
  };
}

/** Todo rascunho tem de passar no contrato do app (título ≤ 60 numa linha, mensagem ≤ 700). */
function assertValidDraft(draft: MatDraft, entity?: unknown) {
  assert.ok(draft.title.length <= OUTREACH_TITLE_MAX, draft.title);
  assert.ok(draft.message.length <= OUTREACH_MESSAGE_MAX, `${draft.message.length}`);
  assert.ok(!/[\r\n]/.test(draft.message));
  const parsed = outreachInputSchema.safeParse({ userId: USER, ...draft, ...(entity ? { entity } : {}) });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
}

describe("ações sugeridas · escalar", () => {
  it("vira pedido de aprovação da Mat com ROAS, gasto e a proposta de +20% por 30 dias", () => {
    const [suggestion] = scaleSuggestions({
      alerts: [alert({ metrics: { purchaseRoas: 6.2, spend: 820 } })],
      accountByCampaign: new Map([["120000000000001", "987654"]]),
      ctx,
    });
    assert.equal(suggestion.situation, "scale");
    assert.match(suggestion.why, /ROAS 6,20x com R\$\s?820 investidos/);
    assert.deepEqual(suggestion.insightIds, ["i1"]);
    const [action] = suggestion.actions;
    assert.equal(action.type, "mat");
    if (action.type !== "mat") return;
    assert.equal(action.draft.kind, "scale_approval");
    assert.deepEqual(action.draft.entity, { level: "campaign", id: "120000000000001", name: "Delivery Pizza", adAccountId: "act_987654" });
    assert.match(action.draft.message, /^Oi, Ana!/);
    assert.match(action.draft.message, /20% a mais de verba por 30 dias/);
    assert.match(action.draft.message, /aprove no app/);
    assertValidDraft(action.draft, action.draft.entity);
  });

  it("descarta ROAS abaixo de 5, gasto abaixo de R$ 50 e insights de outra regra", () => {
    assert.equal(scaleSuggestions({ alerts: [alert({ metrics: { purchaseRoas: 4.9, spend: 900 } })], ctx }).length, 0);
    assert.equal(scaleSuggestions({ alerts: [alert({ metrics: { purchaseRoas: 8, spend: 49 } })], ctx }).length, 0);
    assert.equal(scaleSuggestions({ alerts: [alert({ ruleId: "playbook.roas_trigger", metrics: { purchaseRoas: 8, spend: 900 } })], ctx }).length, 0);
  });

  it("junta vários insights da mesma campanha numa sugestão só", () => {
    const list = scaleSuggestions({
      alerts: [alert({ id: "a", metrics: { purchaseRoas: 5, spend: 50 } }), alert({ id: "b", metrics: { purchaseRoas: 7, spend: 300 }, createdAt: "2026-10-13T10:00:00Z" })],
      ctx,
    });
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].insightIds.sort(), ["a", "b"]);
    assert.match(list[0].why, /ROAS 7,00x/);
  });
});

describe("ações sugeridas · criativo ruim", () => {
  it("gasto ≥ R$ 50 sem resultado é crítico quando leva ≥ 20% da verba", () => {
    const ads = [ad("120111", { spend: 120 }, { share: 0.4 }), ad("120222", { spend: 180, purchases: 6, purchaseValue: 900 }, { share: 0.6 })];
    const [suggestion] = creativeBadSuggestions({ ads, alerts: [], goal: undefined, days: 7, ctx });
    assert.equal(suggestion.id, "creative_bad:120111");
    assert.equal(suggestion.severity, "critical");
    assert.match(suggestion.why, /Gastou R\$\s?120 \(40% da verba\) em 7 dias e não trouxe compras/);
    assert.deepEqual(suggestion.actions.map((action) => action.type), ["meta_pause", "mat", "offer_ai"]);
    const mat = suggestion.actions[1];
    if (mat.type === "mat") assertValidDraft(mat.draft, mat.draft.entity);
  });

  it("abaixo de R$ 50 sem resultado ainda não é ruim", () => {
    const ads = [ad("1", { spend: 49 }, { share: 0.5 }), ad("2", { spend: 50, purchases: 2 }, { share: 0.5 })];
    assert.equal(creativeBadSuggestions({ ads, alerts: [], goal: undefined, days: 7, ctx }).length, 0);
  });

  it("com meta de CPA, compara o custo com a meta (1,3×) e só com ≥ 20% da verba", () => {
    const goal = { kpi: "cpa" as const, target: 20, monthlyBudget: null };
    const bad = ad("1", { spend: 104, purchases: 4 }, { share: 0.3 }); // CPA 26 = 1,3× a meta
    const ok = ad("2", { spend: 100, purchases: 4 }, { share: 0.3 }); // CPA 25 < 26
    const small = ad("3", { spend: 60, purchases: 1 }, { share: 0.15 }); // CPA 60, mas só 15% da verba
    const list = creativeBadSuggestions({ ads: [bad, ok, small], alerts: [], goal, days: 7, ctx });
    assert.deepEqual(list.map((item) => item.id), ["creative_bad:1"]);
    assert.match(list[0].why, /CPA de R\$\s?26,00 — 1,3× a meta de R\$\s?20,00 — levando 30% da verba/);
  });

  it("sem meta de custo (ou com meta de ROAS), compara com a média da conta", () => {
    const ads = [
      ad("1", { spend: 300, purchases: 5 }, { share: 0.5 }), // CPA 60
      ad("2", { spend: 300, purchases: 15 }, { share: 0.5 }), // CPA 20
    ];
    assert.equal(blendedCost(ads, "compras"), 30);
    for (const goal of [undefined, { kpi: "roas" as const, target: 4, monthlyBudget: null }]) {
      const list = creativeBadSuggestions({ ads, alerts: [], goal, days: 7, ctx });
      assert.deepEqual(list.map((item) => item.id), ["creative_bad:1"]);
      assert.equal(list[0].severity, "critical"); // 2× a média
      assert.match(list[0].why, /2,0× a média da conta \(R\$\s?30,00\)/);
    }
  });

  it("meta de outro tipo de resultado (CPL numa conta de compras) cai na média da conta", () => {
    const goal = { kpi: "cpl" as const, target: 5, monthlyBudget: null };
    const ads = [ad("1", { spend: 100, purchases: 4 }, { share: 0.5 }), ad("2", { spend: 100, purchases: 4 }, { share: 0.5 })];
    assert.equal(creativeBadSuggestions({ ads, alerts: [], goal, days: 7, ctx }).length, 0);
  });

  it("diagnóstico de criativo aberto (pesando no resultado) entra; 'parece ok' não", () => {
    const ads = [ad("1", { spend: 40, purchases: 2 }, { share: 0.1 }), ad("2", { spend: 360, purchases: 18 }, { share: 0.9 })];
    const diagnosis = alert({ id: "d1", ruleId: "playbook.creative_diagnosis", entityLevel: "ad", entityId: "1", actionType: "review_creative", metrics: { likelyContributor: true }, evidence: 'Anúncio "X": gancho fraco.' });
    const okDiagnosis = { ...diagnosis, id: "d2", entityId: "2", actionType: "review_other_causes", metrics: { likelyContributor: false } };
    const list = creativeBadSuggestions({ ads, alerts: [diagnosis, okDiagnosis], goal: undefined, days: 7, ctx });
    assert.deepEqual(list.map((item) => item.id), ["creative_bad:1"]);
    assert.deepEqual(list[0].insightIds, ["d1"]);
    assert.match(list[0].why, /Diagnóstico do criativo: Anúncio "X": gancho fraco\./);
  });

  it("ignora anúncio pausado e corta em 3, os mais graves primeiro", () => {
    const ads = [
      ad("p", { spend: 500 }, { share: 0.5, status: "PAUSED" }),
      ...["a", "b", "c", "d"].map((id, index) => ad(id, { spend: 60 + index }, { share: 0.1 })),
      ad("z", { spend: 200 }, { share: 0.3 }),
    ];
    const list = creativeBadSuggestions({ ads, alerts: [], goal: undefined, days: 7, ctx });
    assert.equal(list.length, 3);
    assert.equal(list[0].id, "creative_bad:z");
    assert.ok(!list.some((item) => item.id === "creative_bad:p"));
  });
});

describe("ações sugeridas · pixel", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const sales = [{ campaignId: "c1", name: "Vendas Outubro", spend: 300, purchases: 4 }];
  const pixel = (lastFiredTime: string | null, isUnavailable = false): PixelReading => ({ id: "px1", name: "Pixel Loja", lastFiredTime, isUnavailable });

  it("sem pixel: crítico com campanha de vendas gastando, só informativo sem ela", () => {
    const withSales = evaluatePixel({ pixels: [], salesCampaigns: sales, days: 7, now });
    assert.equal(withSales.problem, "no_pixel");
    assert.equal(withSales.severity, "critical");
    assert.match(withSales.why, /campanha de vendas "Vendas Outubro" gastou R\$\s?300 em 7 dias/);
    assert.equal(evaluatePixel({ pixels: [], salesCampaigns: [], days: 7, now }).severity, "info");
  });

  it("pixel indisponível é problema", () => {
    assert.equal(evaluatePixel({ pixels: [pixel("2026-10-13T10:00:00Z", true)], salesCampaigns: [], days: 7, now }).problem, "unavailable");
  });

  it("parado há mais de 3 dias enquanto vendas gasta é crítico; com exatamente 3 dias, ainda não", () => {
    const stale = evaluatePixel({ pixels: [pixel("2026-10-09T11:00:00Z")], salesCampaigns: sales, days: 7, now });
    assert.equal(stale.problem, "stale");
    assert.equal(stale.daysSinceFired, 4);
    assert.match(stale.why, /não dispara há 4 dias/);
    assert.equal(evaluatePixel({ pixels: [pixel("2026-10-10T12:00:00Z")], salesCampaigns: sales, days: 7, now }).status, "ok");
    assert.equal(evaluatePixel({ pixels: [pixel(null)], salesCampaigns: sales, days: 7, now }).summary, "Pixel nunca disparou");
  });

  it("parado sem campanha de vendas gastando não é problema", () => {
    assert.equal(evaluatePixel({ pixels: [pixel("2026-09-01T00:00:00Z")], salesCampaigns: [{ ...sales[0], spend: 0 }], days: 7, now }).status, "ok");
  });

  it("usa o pixel que disparou mais recentemente entre os disponíveis", () => {
    const verdict = evaluatePixel({ pixels: [pixel("2026-09-01T00:00:00Z"), { ...pixel("2026-10-13T09:00:00Z"), id: "px2", name: "Novo" }], salesCampaigns: sales, days: 7, now });
    assert.equal(verdict.status, "ok");
    assert.equal(verdict.pixel?.id, "px2");
  });

  it("pixel ativo mas campanha de vendas com ≥ R$ 50 e zero compras pede conferir o evento Compra", () => {
    const verdict = evaluatePixel({ pixels: [pixel("2026-10-13T09:00:00Z")], salesCampaigns: [{ ...sales[0], purchases: 0 }], days: 7, now });
    assert.equal(verdict.problem, "no_purchases");
    const suggestion = pixelSuggestion({ verdict, adAccountId: "act_1", accountName: "Loja", ctx });
    const action = suggestion?.actions[0];
    assert.equal(action?.type, "mat");
    if (action?.type === "mat") {
      assert.equal(action.draft.kind, "pixel_setup");
      assert.match(action.draft.message, /evento Compra/);
      assertValidDraft(action.draft);
    }
  });
});

describe("ações sugeridas · saldo", () => {
  const base: BalanceCheckInput = {
    currency: "BRL",
    isPrepaid: true,
    money: { kind: "available", display: "R$ 400,00" },
    accountStatus: 1,
    disableReason: 0,
    amountSpent: null,
    spendCap: null,
    avgDailySpend7d: 50,
  };

  it("pré-paga com saldo folgado está ok", () => {
    const verdict = evaluateBalance(base);
    assert.equal(verdict.status, "ok");
    assert.match(verdict.summary, /R\$ 400,00 · ~8 dias/);
  });

  it("pré-paga abaixo de R$ 50 é saldo baixo", () => {
    const verdict = evaluateBalance({ ...base, money: { kind: "available", display: "Saldo disponível (R$ 45,00 BRL)" }, avgDailySpend7d: 5 });
    assert.deepEqual(verdict.problems, ["prepaid_low"]);
    assert.equal(verdict.severity, "warning");
  });

  it("pré-paga com menos de 3 dias da média dos últimos 7 é saldo baixo; menos de 1 dia é crítico", () => {
    const two = evaluateBalance({ ...base, money: { kind: "available", display: "R$ 120,00" }, avgDailySpend7d: 60 });
    assert.deepEqual(two.problems, ["prepaid_low"]);
    assert.match(two.why, /dá para ~2 dias no ritmo dos últimos 7 dias \(R\$\s?60\/dia\)/);
    assert.equal(evaluateBalance({ ...base, money: { kind: "available", display: "R$ 80,00" }, avgDailySpend7d: 100 }).severity, "critical");
  });

  it("saldo zerado é crítico e a Mat manda o link de cobrança desta conta", () => {
    const verdict = evaluateBalance({ ...base, money: { kind: "available", display: "R$ 0,00" } });
    assert.deepEqual(verdict.problems, ["prepaid_empty"]);
    const suggestion = balanceSuggestion({ verdict, adAccountId: "act_123456", accountName: "Loja", ctx });
    assert.equal(suggestion?.title, "Saldo acabou");
    const mat = suggestion?.actions.find((action) => action.type === "mat");
    const link = suggestion?.actions.find((action) => action.type === "link");
    assert.ok(mat?.type === "mat" && mat.draft.message.includes("asset_id=123456"));
    assert.ok(link?.type === "link" && link.href === metaBillingSettingsUrl("act_123456"));
    if (mat?.type === "mat") {
      assert.equal(mat.draft.kind, "ad_balance");
      assertValidDraft(mat.draft);
    }
  });

  it("status 3 (não quitada) e disable_reason 3 são críticos; 9 (carência) é atenção", () => {
    const postpaid = { ...base, isPrepaid: false, money: { kind: "owed" as const, amountMajor: 320 } };
    assert.deepEqual(evaluateBalance({ ...postpaid, accountStatus: 3 }).problems, ["unsettled"]);
    assert.equal(evaluateBalance({ ...postpaid, accountStatus: 3 }).severity, "critical");
    assert.deepEqual(evaluateBalance({ ...postpaid, accountStatus: 2, disableReason: 3 }).problems, ["payment_disabled"]);
    const grace = evaluateBalance({ ...postpaid, accountStatus: 9 });
    assert.deepEqual(grace.problems, ["grace_period"]);
    assert.equal(grace.severity, "warning");
    assert.equal(evaluateBalance({ ...postpaid, accountStatus: 2, disableReason: 1 }).status, "ok");
  });

  it("limite de gastos atingido é crítico; perto (menos de 3 dias) é atenção", () => {
    const postpaid = { ...base, isPrepaid: false, money: { kind: "owed" as const, amountMajor: 0 } };
    assert.equal(evaluateBalance({ ...postpaid, amountSpent: 1000, spendCap: 1000 }).severity, "critical");
    const near = evaluateBalance({ ...postpaid, amountSpent: 900, spendCap: 1000, avgDailySpend7d: 50 });
    assert.deepEqual(near.problems, ["spend_cap"]);
    assert.equal(near.severity, "warning");
    assert.equal(evaluateBalance({ ...postpaid, amountSpent: 500, spendCap: 1000 }).status, "ok");
  });

  it("dinheiro bloqueado por permissão é 'unknown', não problema", () => {
    assert.equal(evaluateBalance({ ...base, money: { kind: "blocked" }, isPrepaid: null }).status, "unknown");
  });

  it("conta em outra moeda não usa o piso de R$ 50, só os dias de saldo", () => {
    assert.equal(evaluateBalance({ ...base, currency: "USD", money: { kind: "available", display: "$40.00" }, avgDailySpend7d: 5 }).status, "ok");
  });
});

describe("link da cobrança e nome", () => {
  it("monta o deep link da Central de Cobranças com asset_id sem act_", () => {
    assert.equal(
      metaBillingSettingsUrl("act_998877"),
      "https://adsmanager.facebook.com/adsmanager/billing_hub/payment_settings?asset_id=998877&placement=BILLING_HUB",
    );
    assert.equal(
      metaBillingSettingsUrl("998877", "55"),
      "https://adsmanager.facebook.com/adsmanager/billing_hub/payment_settings?asset_id=998877&business_id=55&placement=BILLING_HUB",
    );
  });

  it("primeiro nome para a saudação, nunca o e-mail", () => {
    assert.equal(firstNameOf("ANA souza"), "Ana");
    assert.equal(firstNameOf("dono@loja.com"), null);
    assert.equal(firstNameOf(null), null);
  });
});
