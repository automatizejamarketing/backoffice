import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { duplicateAd } from "../lib/meta-business/duplicate";
import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaFetchStub,
  type MetaRequest,
} from "./helpers/meta-fetch-stub";

/**
 * Regra de 30/09/2026: toda cópia de anúncio pede a expansão sem corte, mantém
 * o resto da origem e desliga os cortes. No 3858023 o reparo tira a expansão e
 * deixa adaptação e cortes desligados.
 */

ensureMetaTestEnv();

const OPT_IN = { enroll_status: "OPT_IN" };
const OPT_OUT = { enroll_status: "OPT_OUT" };
const SOURCE_FEATURES = {
  video_auto_crop: OPT_IN,
  image_touchups: OPT_IN,
  adapt_to_placement: { enroll_status: "OPT_IN", customizations: { image_crop_style: "AUTO" } },
  text_optimizations: OPT_IN,
  standard_enhancements: OPT_IN,
};

let stub: MetaFetchStub | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

function patchFeatures(req: MetaRequest): Record<string, { enroll_status: string; customizations?: unknown }> {
  const patch = JSON.parse(req.params.get("creative_parameters") ?? "{}");
  return patch.degrees_of_freedom_spec?.creative_features_spec ?? {};
}

function metaWithSourceAd(
  opts: { ineligible?: boolean; refusalSubcode?: number; creative?: boolean } = {},
): MetaFetchStub {
  stub = installMetaFetchStub((req) => {
    if (req.method === "GET" && req.path === "ad_1") {
      return {
        body: {
          name: "Anúncio 1",
          adset_id: "as_1",
          ...(opts.creative === false
            ? {}
            : {
                creative: {
                  id: "cr_1",
                  degrees_of_freedom_spec: { creative_features_spec: SOURCE_FEATURES },
                  object_story_spec: { page_id: "p_1", link_data: { link: "https://loja.example" } },
                },
              }),
        },
      };
    }
    if (req.method === "GET" && req.path === "as_1/ads") {
      return { body: { data: [{ name: "Anúncio 1" }] } };
    }
    if (req.method === "POST" && req.path === "ad_1/copies") {
      if (opts.ineligible && patchFeatures(req).image_uncrop?.enroll_status === "OPT_IN") {
        return {
          status: 400,
          body: graphErrorBody({
            message: "Invalid parameter",
            code: 100,
            errorSubcode: opts.refusalSubcode ?? 3858023,
          }),
        };
      }
      return { body: { copied_ad_id: "ad_2" } };
    }
    if (req.method === "POST" && req.path === "ad_2") return { body: { success: true } };
    return { status: 500, body: graphErrorBody({ message: `unexpected ${req.method} ${req.path}` }) };
  });
  return stub;
}

const copies = (s: MetaFetchStub) => s.calls.filter((c) => c.path === "ad_1/copies");

describe("duplicateAd — expansão sem corte por padrão", () => {
  it("a cópia ganha a expansão, troca AUTO por EXPAND, desliga cortes e mantém o resto", async () => {
    const s = metaWithSourceAd();

    const result = await duplicateAd({ accountId: "act_1", adId: "ad_1", accessToken: "tok" });

    assert.equal(result.id, "ad_2");
    const features = patchFeatures(copies(s)[0]);
    assert.deepEqual(features.image_uncrop, OPT_IN);
    assert.deepEqual(features.video_uncrop, OPT_IN);
    assert.deepEqual(features.pac_relaxation, OPT_IN);
    assert.deepEqual(features.adapt_to_placement, {
      enroll_status: "OPT_IN",
      customizations: { image_crop_style: "EXPAND" },
    });
    assert.deepEqual(features.video_auto_crop, OPT_OUT);
    assert.deepEqual(features.image_touchups, OPT_OUT);
    assert.deepEqual(features.text_optimizations, OPT_IN);
    assert.equal("standard_enhancements" in features, false);
  });

  it("no 3858023 o reparo tira a expansão e deixa adaptação e cortes desligados", async () => {
    const s = metaWithSourceAd({ ineligible: true });

    const result = await duplicateAd({ accountId: "act_1", adId: "ad_1", accessToken: "tok" });

    assert.equal(result.id, "ad_2");
    const attempts = copies(s);
    assert.equal(attempts.length, 2);
    const features = patchFeatures(attempts[1]);
    assert.equal("image_uncrop" in features, false);
    assert.equal("video_uncrop" in features, false);
    assert.deepEqual(features.adapt_to_placement, OPT_OUT);
    assert.deepEqual(features.pac_relaxation, OPT_OUT);
    assert.deepEqual(features.video_auto_crop, OPT_OUT);
    assert.deepEqual(features.image_touchups, OPT_OUT);
    assert.deepEqual(features.text_optimizations, OPT_IN);
    assert.equal("standard_enhancements" in features, false);
  });

  it("3858028 (criativo dinâmico, oferta…) usa o mesmo reparo", async () => {
    const s = metaWithSourceAd({ ineligible: true, refusalSubcode: 3858028 });

    const result = await duplicateAd({ accountId: "act_1", adId: "ad_1", accessToken: "tok" });

    assert.equal(result.id, "ad_2");
    const attempts = copies(s);
    assert.equal(attempts.length, 2);
    const features = patchFeatures(attempts[1]);
    assert.equal("image_uncrop" in features, false);
    assert.deepEqual(features.adapt_to_placement, OPT_OUT);
    assert.deepEqual(features.video_auto_crop, OPT_OUT);
  });

  it("sem o criativo na leitura, a cópia sai normalmente sem patch", async () => {
    const s = metaWithSourceAd({ creative: false });

    const result = await duplicateAd({ accountId: "act_1", adId: "ad_1", accessToken: "tok" });

    assert.equal(result.id, "ad_2");
    assert.equal(copies(s)[0].params.get("creative_parameters"), null);
  });
});
