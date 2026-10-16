import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { duplicateAd, duplicateAdSet, duplicateCampaign } from "../lib/meta-business/duplicate";
import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaFetchStub,
  type MetaRequest,
} from "./helpers/meta-fetch-stub";

/**
 * Duplicar campanha de "visitas ao perfil do Instagram" (caso Divino Lanches, 01/10/2026).
 *
 * Comportamento da Meta reproduzido aqui, provado ao vivo em 01/10 na conta
 * act_1038784634408465 (cópias pausadas e apagadas por ID):
 * - o `/copies` do conjunto troca `optimization_goal` VISIT_INSTAGRAM_PROFILE → PROFILE_VISIT;
 * - com a meta trocada, a cópia do anúncio é recusada (2061015 sem botão, 3858615 com o
 *   "Saiba mais");
 * - devolvida a meta original ao conjunto copiado, a cópia nativa passa;
 * - o `/copies` de criativo de post do IG descarta o `call_to_action` de topo, então a
 *   cópia só mantém o botão se ele for reenviado em `creative_parameters`.
 */

ensureMetaTestEnv();

const ACCOUNT = "1038784634408465";
const ACT = `act_${ACCOUNT}`;
const CAMPAIGN_ID = "120247804727300476";
const ADSET_ID = "120247804727630476";
const AD_ID = "120247804728490476";
const NEW_CAMPAIGN = "copy_camp";
const NEW_ADSET = "copy_as";
const NEW_AD = "copy_ad";
const NAME = "[AM][TRAFEGO][FS][2026-10-01-15-10-26]";
const PROFILE_CTA = {
  type: "LEARN_MORE",
  value: { link: "https://www.instagram.com/divinolanche.s" },
};

const IG_POST_CREATIVE = {
  id: "1021351014344623",
  call_to_action: PROFILE_CTA,
  source_instagram_media_id: "18127551551510715",
  degrees_of_freedom_spec: {
    creative_features_spec: {
      adapt_to_placement: { enroll_status: "OPT_IN", customizations: { image_crop_style: "EXPAND" } },
    },
  },
};

const SOURCE_ADSET = {
  id: ADSET_ID,
  name: `${NAME} - Ad Set`,
  configured_status: "ACTIVE",
  billing_event: "IMPRESSIONS",
  optimization_goal: "VISIT_INSTAGRAM_PROFILE",
  optimization_sub_event: "NONE",
  destination_type: "INSTAGRAM_PROFILE",
  promoted_object: { page_id: "437976056061697", smart_pse_enabled: false },
  start_time: "2026-10-01T12:10:28-0300",
  end_time: "2099-10-08T12:09:00-0300",
  is_dynamic_creative: false,
  targeting: {
    geo_locations: { countries: ["BR"] },
    targeting_automation: { advantage_audience: 0 },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  },
};

const TREE = {
  id: CAMPAIGN_ID,
  name: NAME,
  objective: "OUTCOME_TRAFFIC",
  smart_promotion_type: "GUIDED_CREATION",
  lifetime_budget: "14000",
  pacing_type: ["standard"],
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  adsets: {
    data: [{ id: ADSET_ID, name: SOURCE_ADSET.name, ads: { data: [{ id: AD_ID, name: `${NAME} - Ad` }] } }],
  },
};

let stub: MetaFetchStub | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

function creativeParams(req: MetaRequest): Record<string, unknown> {
  return JSON.parse(req.params.get("creative_parameters") ?? "{}");
}

/**
 * Meta simulada: o conjunto copiado nasce com PROFILE_VISIT e só volta a aceitar a cópia
 * do anúncio depois que alguém devolve VISIT_INSTAGRAM_PROFILE a ele.
 */
function installMeta(opts: { goalRestoreFails?: boolean; adCopyRefused?: boolean } = {}): MetaFetchStub {
  let copiedAdsetGoal = "PROFILE_VISIT";
  stub = installMetaFetchStub((req) => {
    if (req.method === "GET") {
      if (req.path === CAMPAIGN_ID) return { body: TREE };
      if (req.path === `${ACT}/campaigns`) return { body: { data: [{ id: CAMPAIGN_ID, name: NAME }] } };
      if (req.path === "" && req.params.has("ids")) {
        const out: Record<string, unknown> = {};
        for (const id of (req.params.get("ids") ?? "").split(",")) {
          if (id === AD_ID) out[id] = { id: AD_ID, creative: IG_POST_CREATIVE };
          if (id === ADSET_ID) out[id] = SOURCE_ADSET;
          if (id === IG_POST_CREATIVE.source_instagram_media_id) {
            out[id] = { id, boost_eligibility_info: { eligible_to_boost: true } };
          }
        }
        return { body: out };
      }
      if (req.path === ADSET_ID) return { body: { ...SOURCE_ADSET, campaign_id: CAMPAIGN_ID } };
      if (req.path === AD_ID) {
        return { body: { name: `${NAME} - Ad`, adset_id: ADSET_ID, creative: IG_POST_CREATIVE } };
      }
      if (req.path === `${ADSET_ID}/ads`) {
        return { body: { data: [{ id: AD_ID, name: `${NAME} - Ad`, creative: IG_POST_CREATIVE }] } };
      }
      if (req.path === NEW_ADSET) return { body: { id: NEW_ADSET, optimization_goal: copiedAdsetGoal } };
      return { body: {} };
    }
    if (req.method === "POST") {
      if (req.path === `${CAMPAIGN_ID}/copies`) return { body: { copied_campaign_id: NEW_CAMPAIGN } };
      if (req.path === `${ADSET_ID}/copies`) return { body: { copied_adset_id: NEW_ADSET } };
      if (req.path === NEW_ADSET && req.params.has("optimization_goal")) {
        if (opts.goalRestoreFails) {
          return {
            status: 400,
            body: graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 1815198 }),
          };
        }
        copiedAdsetGoal = req.params.get("optimization_goal") ?? copiedAdsetGoal;
        return { body: { success: true } };
      }
      if (req.path === `${AD_ID}/copies`) {
        const target = req.params.get("adset_id");
        if (opts.adCopyRefused || (target === NEW_ADSET && copiedAdsetGoal === "PROFILE_VISIT")) {
          const withCta = "call_to_action" in creativeParams(req);
          return {
            status: 400,
            body: graphErrorBody({
              message: "Invalid parameter",
              code: 100,
              errorSubcode: withCta ? 3858615 : 2061015,
              userTitle: withCta
                ? "Não é possível usar a chamada para ação selecionada"
                : "Um campo obrigatório precisa ser preenchido",
              userMsg: withCta
                ? "Sua chamada para ação não pode ser usada para sua meta de desempenho. Para continuar, selecione uma chamada para ação diferente."
                : "O campo de website URL é obrigatório. Preencha o campo para continuar.",
            }),
          };
        }
        return { body: { copied_ad_id: NEW_AD } };
      }
      return { body: { success: true } };
    }
    if (req.method === "DELETE") return { body: { success: true } };
    return { body: {} };
  });
  return stub;
}

const adCopies = (s: MetaFetchStub) =>
  s.calls.filter((c) => c.method === "POST" && c.path === `${AD_ID}/copies`);
const goalWrites = (s: MetaFetchStub) =>
  s.calls.filter((c) => c.method === "POST" && c.path === NEW_ADSET && c.params.has("optimization_goal"));

describe("duplicar campanha de visitas ao perfil do Instagram", () => {
  it("devolve VISIT_INSTAGRAM_PROFILE ao conjunto copiado antes de copiar o anúncio", async () => {
    const s = installMeta();

    const result = await duplicateCampaign({ accountId: ACCOUNT, campaignId: CAMPAIGN_ID, accessToken: "tok" });

    assert.equal(result.id, NEW_CAMPAIGN);
    const [restore] = goalWrites(s);
    assert.ok(restore, "a meta do conjunto copiado foi restaurada");
    assert.equal(restore.params.get("optimization_goal"), "VISIT_INSTAGRAM_PROFILE");
    const firstAdCopy = s.calls.indexOf(adCopies(s)[0]);
    assert.ok(s.calls.indexOf(restore) < firstAdCopy, "a meta volta antes da cópia do anúncio");
    assert.equal(adCopies(s).length, 1, "a cópia do anúncio passa de primeira");
    assert.equal(s.calls.filter((c) => c.method === "DELETE").length, 0, "nada é desfeito");
  });

  it("a cópia do anúncio de post do IG reenvia o botão do original", async () => {
    const s = installMeta();

    await duplicateCampaign({ accountId: ACCOUNT, campaignId: CAMPAIGN_ID, accessToken: "tok" });

    const [copy] = adCopies(s);
    assert.deepEqual(creativeParams(copy).call_to_action, PROFILE_CTA);
  });

  it("não reescreve a meta de conjuntos de outros destinos", async () => {
    const s = installMeta();
    SOURCE_ADSET.optimization_goal = "LINK_CLICKS";
    SOURCE_ADSET.destination_type = "WEBSITE";
    try {
      await duplicateCampaign({ accountId: ACCOUNT, campaignId: CAMPAIGN_ID, accessToken: "tok" }).catch(() => undefined);
      assert.equal(goalWrites(s).length, 0);
    } finally {
      SOURCE_ADSET.optimization_goal = "VISIT_INSTAGRAM_PROFILE";
      SOURCE_ADSET.destination_type = "INSTAGRAM_PROFILE";
    }
  });

  it("se a Meta recusar a volta da meta, a duplicação é desfeita com o erro dela", async () => {
    const s = installMeta({ goalRestoreFails: true });

    await assert.rejects(
      duplicateCampaign({ accountId: ACCOUNT, campaignId: CAMPAIGN_ID, accessToken: "tok" }),
      /1815198/,
    );
    assert.equal(adCopies(s).length, 0, "nenhum anúncio é copiado para um conjunto com a meta trocada");
    assert.ok(
      s.calls.some((c) => c.method === "DELETE" && c.path === NEW_CAMPAIGN),
      "a campanha copiada é apagada",
    );
  });
});

describe("duplicar conjunto de visitas ao perfil do Instagram", () => {
  it("se a Meta recusar a volta da meta, o conjunto copiado é apagado (não fica órfão)", async () => {
    const s = installMeta({ goalRestoreFails: true });

    await assert.rejects(
      duplicateAdSet({ accountId: ACCOUNT, adsetId: ADSET_ID, accessToken: "tok", cboDaypartingReleased: false }),
      /1815198/,
    );
    assert.equal(adCopies(s).length, 0);
    assert.ok(
      s.calls.some((c) => c.method === "DELETE" && c.path === NEW_ADSET),
      "o conjunto copiado é apagado",
    );
  });
});

describe("duplicar anúncio de post do IG no mesmo conjunto", () => {
  it("reenvia o botão do original na cópia", async () => {
    const s = installMeta();

    const result = await duplicateAd({ accountId: ACT, adId: AD_ID, accessToken: "tok" });

    assert.equal(result.id, NEW_AD);
    const [copy] = adCopies(s);
    assert.deepEqual(creativeParams(copy).call_to_action, PROFILE_CTA);
  });
});

describe("quando a Meta ainda recusa o botão (3858615)", () => {
  it("a mensagem orienta o cliente a falar com o suporte em vez de trocar o botão", async () => {
    installMeta({ adCopyRefused: true });

    const err = await duplicateAd({ accountId: ACT, adId: AD_ID, accessToken: "tok" }).then(
      () => assert.fail("a duplicação deveria falhar"),
      (e: unknown) => e as Error,
    );

    assert.match(err.message, /código 3858615/);
    assert.match(err.message, /suporte/);
  });
});
