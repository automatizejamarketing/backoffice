import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ADVANTAGE_CREATIVE_UNSUPPORTED_SUBCODE,
  AI_PLACEMENT_ADAPTATION,
  CROPPING_FEATURES,
  DEFAULT_PLACEMENT_ADAPTATION,
  GENERATIVE_FEATURES,
  GENERATIVE_FEATURES_INELIGIBLE_SUBCODE,
  IMAGE_CROP_STYLES,
  NO_PLACEMENT_ADAPTATION,
  PLACEMENT_EXPANSION_REFUSED_SUBCODES,
  REFRAMING_FEATURES,
  buildCreativeFeaturesSpec,
  buildDegreesOfFreedomSpec,
  isGenerativeIneligibleError,
  withPlacementAdaptation,
  withPlacementExpansion,
  withoutGenerativeFeatures,
} from "./creative-features";

/**
 * Regra de produto de 30/09/2026: todo criativo pede a expansão de formato SEM
 * corte; conta sem IA generativa (3858023) cai para NENHUM recurso. Contrato da
 * API levantado por sondagem ao vivo (v25, 18/08 e 23/09/2026):
 *
 * - só emitimos chaves em `OPT_IN` num criativo novo (o Meta materializa as 82
 *   como `OPT_OUT` sozinho);
 * - `standard_enhancements` é rejeitado na criação desde a v22;
 * - na cópia, o spec da origem é mesclado e os cortes saem em `OPT_OUT`.
 */

const OPT_IN = { enroll_status: "OPT_IN" };
const OPT_OUT = { enroll_status: "OPT_OUT" };
const EXPANSION_SPEC = {
  adapt_to_placement: { enroll_status: "OPT_IN", customizations: { image_crop_style: "EXPAND" } },
  pac_relaxation: OPT_IN,
  image_uncrop: OPT_IN,
  video_uncrop: OPT_IN,
};

describe("padrão do produto = expansão sem corte", () => {
  test("sem argumento pede adapt_to_placement EXPAND, pac_relaxation e os dois uncrop", () => {
    assert.deepEqual(buildCreativeFeaturesSpec(), EXPANSION_SPEC);
  });

  test("o padrão não pede nenhum recurso de corte", () => {
    const spec = buildCreativeFeaturesSpec();
    for (const key of CROPPING_FEATURES) {
      assert.equal(spec?.[key], undefined, `${key} corta e não pode vir no padrão`);
    }
  });

  test("AI_PLACEMENT_ADAPTATION é o próprio padrão", () => {
    assert.deepEqual(AI_PLACEMENT_ADAPTATION, DEFAULT_PLACEMENT_ADAPTATION);
    assert.deepEqual(DEFAULT_PLACEMENT_ADAPTATION, {
      enabled: true,
      generativeExpansion: true,
      imageCropStyle: "EXPAND",
    });
  });

  test("NO_PLACEMENT_ADAPTATION não manda o campo", () => {
    assert.equal(buildCreativeFeaturesSpec(NO_PLACEMENT_ADAPTATION), null);
    assert.equal(buildDegreesOfFreedomSpec(NO_PLACEMENT_ADAPTATION), null);
  });

  test("nunca emite OPT_OUT explícito num criativo novo", () => {
    const statuses = Object.values(buildCreativeFeaturesSpec() ?? {}).map((f) => f.enroll_status);
    assert.ok(statuses.length > 0);
    assert.ok(statuses.every((s) => s === "OPT_IN"));
  });

  test("reenquadramento explícito continua possível para quem pedir", () => {
    const spec = buildCreativeFeaturesSpec({ generativeExpansion: false, imageCropStyle: "AUTO" });
    assert.deepEqual(spec?.video_auto_crop, OPT_IN);
    assert.equal(spec?.image_uncrop, undefined);
    assert.deepEqual(spec?.adapt_to_placement, {
      enroll_status: "OPT_IN",
      customizations: { image_crop_style: "AUTO" },
    });
  });

  test("reenquadramento e generativos são listas disjuntas", () => {
    const overlap = REFRAMING_FEATURES.filter((k) =>
      (GENERATIVE_FEATURES as readonly string[]).includes(k),
    );
    assert.deepEqual(overlap, []);
  });

  test("IMAGE_CROP_STYLES traz o enum que o validador da v25 aceitou", () => {
    assert.deepEqual([...IMAGE_CROP_STYLES], ["AUTO", "CROP", "EXPAND", "NONE", "ZOOM"]);
  });

  test("buildDegreesOfFreedomSpec embrulha o spec no campo do POST /adcreatives", () => {
    assert.deepEqual(buildDegreesOfFreedomSpec(), { creative_features_spec: EXPANSION_SPEC });
  });
});

describe("withPlacementAdaptation (cópia de criativo existente)", () => {
  test("preserva o que a origem tinha", () => {
    const merged = withPlacementAdaptation({ inline_comment: OPT_IN, text_optimizations: OPT_OUT });
    assert.deepEqual(merged?.inline_comment, OPT_IN);
    assert.deepEqual(merged?.text_optimizations, OPT_OUT);
  });

  test("desliga os recursos de corte que a origem tinha ligados", () => {
    const merged = withPlacementAdaptation({ video_auto_crop: OPT_IN, image_touchups: OPT_IN });
    assert.deepEqual(merged?.video_auto_crop, OPT_OUT);
    assert.deepEqual(merged?.image_touchups, OPT_OUT);
  });

  test("troca o recorte AUTO da origem por EXPAND", () => {
    const merged = withPlacementAdaptation({
      adapt_to_placement: { enroll_status: "OPT_IN", customizations: { image_crop_style: "AUTO" } },
    });
    assert.deepEqual(merged?.adapt_to_placement, EXPANSION_SPEC.adapt_to_placement);
  });

  test("sem spec de origem = expansão + cortes desligados", () => {
    assert.deepEqual(withPlacementAdaptation(undefined), {
      video_auto_crop: OPT_OUT,
      image_touchups: OPT_OUT,
      ...EXPANSION_SPEC,
    });
  });

  test("remove standard_enhancements — rejeitado na criação desde a v22", () => {
    const merged = withPlacementAdaptation({ standard_enhancements: OPT_IN });
    assert.ok(merged && !("standard_enhancements" in merged));
  });

  test("desligado devolve null e o chamador não patcheia nada", () => {
    assert.equal(withPlacementAdaptation({ inline_comment: OPT_IN }, NO_PLACEMENT_ADAPTATION), null);
  });

  test("não muta o objeto de origem", () => {
    const source = { standard_enhancements: OPT_IN, video_auto_crop: OPT_IN };
    withPlacementAdaptation(source);
    assert.deepEqual(source, { standard_enhancements: OPT_IN, video_auto_crop: OPT_IN });
  });
});

describe("withoutGenerativeFeatures (plano B da cópia no 3858023)", () => {
  test("tira a expansão e deixa adaptação e cortes desligados, mantendo o resto", () => {
    const stripped = withoutGenerativeFeatures(
      withPlacementAdaptation({ inline_comment: OPT_OUT, text_optimizations: OPT_IN }) ?? undefined,
    );
    assert.ok(stripped);
    for (const key of GENERATIVE_FEATURES) assert.equal(key in stripped, false);
    assert.deepEqual(stripped.adapt_to_placement, OPT_OUT);
    assert.deepEqual(stripped.pac_relaxation, OPT_OUT);
    assert.deepEqual(stripped.video_auto_crop, OPT_OUT);
    assert.deepEqual(stripped.image_touchups, OPT_OUT);
    assert.deepEqual(stripped.inline_comment, OPT_OUT);
    assert.deepEqual(stripped.text_optimizations, OPT_IN);
  });

  test("devolve null quando nada generativo está ligado — a recusa é outra", () => {
    assert.equal(withoutGenerativeFeatures({ image_uncrop: OPT_OUT, pac_relaxation: OPT_IN }), null);
    assert.equal(withoutGenerativeFeatures(undefined), null);
  });

  test("não muta o objeto de origem", () => {
    const source = { image_uncrop: OPT_IN };
    withoutGenerativeFeatures(source);
    assert.deepEqual(source, { image_uncrop: OPT_IN });
  });
});

describe("isGenerativeIneligibleError", () => {
  const subcode = GENERATIVE_FEATURES_INELIGIBLE_SUBCODE;

  test("reconhece MetaApiError (metaError.error_subcode)", () => {
    assert.equal(isGenerativeIneligibleError({ metaError: { error_subcode: subcode } }), true);
  });

  test("reconhece GraphApiError (errorReturn.data.errorSubcode)", () => {
    assert.equal(isGenerativeIneligibleError({ errorReturn: { data: { errorSubcode: subcode } } }), true);
  });

  test("reconhece o corpo cru da Graph (error.error_subcode)", () => {
    assert.equal(isGenerativeIneligibleError({ error: { error_subcode: subcode } }), true);
  });

  test("3858028 (tipo de criativo que não se qualifica) tem o mesmo plano B", () => {
    assert.equal(ADVANTAGE_CREATIVE_UNSUPPORTED_SUBCODE, 3858028);
    assert.deepEqual([...PLACEMENT_EXPANSION_REFUSED_SUBCODES], [3858023, 3858028]);
    assert.equal(isGenerativeIneligibleError({ metaError: { error_subcode: 3858028 } }), true);
    assert.equal(isGenerativeIneligibleError({ errorReturn: { data: { errorSubcode: 3858028 } } }), true);
    assert.equal(isGenerativeIneligibleError({ error: { error_subcode: 3858028 } }), true);
  });

  test("não confunde outro subcode nem lixo", () => {
    assert.equal(isGenerativeIneligibleError({ metaError: { error_subcode: 1487390 } }), false);
    assert.equal(isGenerativeIneligibleError(new Error("x")), false);
    assert.equal(isGenerativeIneligibleError(undefined), false);
    assert.equal(isGenerativeIneligibleError("3858023"), false);
  });
});

describe("withPlacementExpansion", () => {
  const ineligible = { error: { error_subcode: GENERATIVE_FEATURES_INELIGIBLE_SUBCODE } };

  test("o primeiro envio leva o spec padrão", async () => {
    const seen: Array<string | null> = [];
    const result = await withPlacementExpansion(async (spec) => {
      seen.push(spec);
      return "ok";
    });
    assert.equal(result, "ok");
    assert.deepEqual(seen, [JSON.stringify(buildDegreesOfFreedomSpec(DEFAULT_PLACEMENT_ADAPTATION))]);
  });

  test("no 3858023 reenvia UMA vez sem o campo e devolve o segundo resultado", async () => {
    const seen: Array<string | null> = [];
    const result = await withPlacementExpansion(async (spec) => {
      seen.push(spec);
      if (spec) throw ineligible;
      return "sem expansão";
    });
    assert.equal(result, "sem expansão");
    assert.equal(seen.length, 2);
    assert.equal(seen[1], null);
  });

  test("no 3858028 (criativo dinâmico, oferta…) também reenvia uma vez sem o campo", async () => {
    const seen: Array<string | null> = [];
    const result = await withPlacementExpansion(async (spec) => {
      seen.push(spec);
      if (spec) throw { error: { error_subcode: 3858028 } };
      return "sem expansão";
    });
    assert.equal(result, "sem expansão");
    assert.deepEqual(seen.map((s) => s === null), [false, true]);
  });

  test("outro erro sobe sem nova tentativa", async () => {
    let calls = 0;
    await assert.rejects(
      withPlacementExpansion(async () => {
        calls += 1;
        throw { error: { error_subcode: 1487390 } };
      }),
    );
    assert.equal(calls, 1);
  });

  test("se a segunda tentativa também falhar, o erro dela sobe — sem terceira", async () => {
    let calls = 0;
    const second = new Error("segunda");
    await assert.rejects(
      withPlacementExpansion(async (spec) => {
        calls += 1;
        throw spec ? ineligible : second;
      }),
      second,
    );
    assert.equal(calls, 2);
  });
});
