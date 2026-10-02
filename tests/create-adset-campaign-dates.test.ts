import assert from "node:assert/strict";
import test from "node:test";

import { createAdSetInExistingCampaign } from "@/lib/meta-business/marketing/create-adset-in-existing-campaign";
import { resetMetaReadCacheForTests } from "@/lib/meta-business/read-cache";

import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaRequest,
  type MetaStubResponse,
} from "./helpers/meta-fetch-stub";

/**
 * "Criar conjunto" do backoffice (rota `api/meta-marketing/[accountId]/adsets`), que usa o
 * motor espelhado do app. Divino Lanches, 01/10/2026: numa campanha com orçamento total a
 * Meta recusava o conjunto com 100/1487094 porque o POST não levava data de término, e a
 * mensagem saía genérica. Aqui o motor roda contra a tabela de traduções do backoffice.
 */

ensureMetaTestEnv();

const ACCOUNT = "900100200401";
const CAMPAIGN = "120260000000000401";

async function createInCampaignWithTotalBudget(postResponse?: MetaStubResponse) {
  resetMetaReadCacheForTests();
  const stub = installMetaFetchStub((req: MetaRequest) => {
    if (req.method === "GET") {
      if (req.path === CAMPAIGN) {
        return {
          body: {
            id: CAMPAIGN,
            name: "[AM][TRAFEGO][FS] Campanha",
            objective: "OUTCOME_TRAFFIC",
            lifetime_budget: "14000",
            pacing_type: ["standard"],
            bid_strategy: "LOWEST_COST_WITHOUT_CAP",
            start_time: "2099-01-01T10:00:00-0300",
            stop_time: "2099-02-01T10:00:00-0300",
          },
        };
      }
      if (req.path.endsWith("/promote_pages") || req.path === "me/accounts") {
        return {
          body: { data: [{ id: "page_1", name: "Página", instagram_business_account: { id: "ig_1" } }] },
        };
      }
      if (req.path === "adset_new") return { body: { id: "adset_new", name: "Conjunto" } };
      return { body: { data: [] } };
    }
    if (req.method === "POST" && req.path.endsWith("/adsets")) {
      return postResponse ?? { body: { id: "adset_new" } };
    }
    return { body: { success: true } };
  });
  try {
    const result = await createAdSetInExistingCampaign({
      accountId: ACCOUNT,
      accessToken: `tok-bo-${Date.now()}-${Math.random()}`,
      campaignId: CAMPAIGN,
      adsetName: "Conjunto",
      targeting: { age_min: 18, age_max: 65 },
      deliveryMode: "all_day",
    });
    return { result, calls: stub.calls };
  } finally {
    stub.restore();
  }
}

test("orçamento total na campanha: o conjunto novo leva as datas da campanha", async () => {
  const { result, calls } = await createInCampaignWithTotalBudget();
  assert.equal(result.ok, true, JSON.stringify(result));
  const write = calls.find((c) => c.method === "POST" && c.path.endsWith("/adsets"));
  assert.ok(write, "esperava o POST do conjunto");
  assert.equal(write.params.get("start_time"), "2099-01-01T10:00:00-0300");
  assert.equal(write.params.get("end_time"), "2099-02-01T10:00:00-0300");
});

test("Meta recusa o conjunto com erro sem tradução: a resposta traz o motivo dado pela Meta", async () => {
  const { result } = await createInCampaignWithTotalBudget({
    status: 400,
    body: graphErrorBody({
      code: 100,
      errorSubcode: 2446149,
      message: "Invalid parameter",
      userTitle: "O orçamento é muito baixo",
      userMsg:
        "Seu orçamento de campanha deve ser de pelo menos R$38,12 para cobrir todos os conjuntos de anúncios nesta campanha.",
    }),
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error.statusCode, 400);
  assert.equal(
    result.error.message,
    "Seu orçamento de campanha deve ser de pelo menos R$38,12 para cobrir todos os conjuntos de anúncios nesta campanha.",
  );
  assert.equal(
    result.error.solution,
    "Se não souber como resolver, fale com o suporte e informe o código 100/2446149.",
  );
});
