import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";

import { NO_PLACEMENT_ADAPTATION } from "@/lib/meta-business/creative-features";
import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaFetchStub,
  type MetaRequest,
} from "@/tests/helpers/meta-fetch-stub";
import { createCreative, previewAd, type CreateAdInput } from "./create-ad";

ensureMetaTestEnv();

/**
 * Conta de dentista (act_2909378449435362, 23/09/2026): a Meta recusa qualquer
 * criativo que peça `image_uncrop` com 100/3858023. Regra de 30/09/2026: o plano
 * B é o criativo SEM `degrees_of_freedom_spec` — nunca o reenquadramento, que corta.
 */
const INELIGIBLE = graphErrorBody({
  message: "Invalid parameter",
  code: 100,
  errorSubcode: 3858023,
  userTitle: "A conta de anúncios não se qualifica para o Criativo Advantage+",
  userMsg: "A conta de anúncios não está qualificada para o Criativo Advantage+",
});

let stub: MetaFetchStub | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

function featuresOf(req: MetaRequest): Record<string, { enroll_status: string }> {
  const raw = req.params.get("degrees_of_freedom_spec");
  return raw ? JSON.parse(raw).creative_features_spec : {};
}

/** Recusa todo POST de criativo que peça `image_uncrop`; aceita o resto. */
function stubIneligibleAccount(): MetaFetchStub {
  stub = installMetaFetchStub((req) => {
    if (req.method === "POST" && req.path === "act_1/adcreatives") {
      if (featuresOf(req).image_uncrop) return { status: 400, body: INELIGIBLE };
      return req.isValidateOnly ? { body: { success: true } } : { body: { id: "CR1" } };
    }
    return { status: 500, body: graphErrorBody({ message: `unexpected ${req.method} ${req.path}` }) };
  });
  return stub;
}

const imageAd = (overrides: Partial<CreateAdInput> = {}): CreateAdInput => ({
  adAccountId: "act_1",
  accessToken: "tok",
  adSetId: "as1",
  name: "Ad",
  creative: {
    format: "image",
    pageId: "p1",
    imageHash: "H",
    link: "https://x.com",
    cta: { type: "LEARN_MORE", link: "https://x.com" },
  },
  ...overrides,
});

describe("createCreative — conta sem acesso à IA generativa (3858023)", () => {
  it("quem não informa adaptação recebe a expansão; no 3858023 refaz SEM nenhum spec", async () => {
    const s = stubIneligibleAccount();

    const result = await createCreative("act_1", "tok", imageAd(), false);

    assert.deepEqual(result, { id: "CR1" });
    const first = s.calls[0];
    assert.equal(featuresOf(first).image_uncrop?.enroll_status, "OPT_IN");
    const created = s.realCalls().at(-1);
    assert.ok(created);
    assert.equal(created.params.get("degrees_of_freedom_spec"), null);
  });

  it("também se recupera quando a recusa vem na criação real (sem validate_only)", async () => {
    const s = stubIneligibleAccount();

    const result = await createCreative("act_1", "tok", imageAd(), true);

    assert.deepEqual(result, { id: "CR1" });
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls.every((c) => !c.isValidateOnly), true);
    assert.equal(s.calls[1].params.get("degrees_of_freedom_spec"), null);
  });

  it("a escape hatch não traz o campo de volta na nova tentativa", async () => {
    const s = stubIneligibleAccount();

    const result = await createCreative(
      "act_1",
      "tok",
      imageAd({
        placementAdaptation: NO_PLACEMENT_ADAPTATION,
        creativeExtraFields: {
          degrees_of_freedom_spec: { creative_features_spec: { image_uncrop: { enroll_status: "OPT_IN" } } },
          applink_treatment: "deeplink_with_web_fallback",
        },
      }),
      true,
    );

    assert.deepEqual(result, { id: "CR1" });
    const retry = s.calls.at(-1)!;
    assert.equal(retry.params.get("degrees_of_freedom_spec"), null);
    assert.equal(retry.params.get("applink_treatment"), "deeplink_with_web_fallback");
  });

  it("não repete o POST quando o criativo não levou o campo", async () => {
    stub = installMetaFetchStub(() => ({ status: 400, body: INELIGIBLE }));

    const result = await createCreative(
      "act_1",
      "tok",
      imageAd({ placementAdaptation: NO_PLACEMENT_ADAPTATION }),
      false,
    );

    assert.ok("issues" in result);
    assert.equal(result.issues[0]?.metaSubcode, 3858023);
    assert.equal(stub.calls.length, 1);
  });

  it("3858028 (tipo de criativo que não se qualifica) segue o mesmo plano B", async () => {
    stub = installMetaFetchStub((req) => {
      if (req.method === "POST" && req.path === "act_1/adcreatives") {
        if (req.params.get("degrees_of_freedom_spec")) {
          return {
            status: 400,
            body: graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 3858028 }),
          };
        }
        return req.isValidateOnly ? { body: { success: true } } : { body: { id: "CR1" } };
      }
      return { status: 500, body: graphErrorBody({ message: `unexpected ${req.method} ${req.path}` }) };
    });

    const result = await createCreative("act_1", "tok", imageAd(), true);

    assert.deepEqual(result, { id: "CR1" });
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[1].params.get("degrees_of_freedom_spec"), null);
  });

  it("outro erro não dispara nova tentativa", async () => {
    stub = installMetaFetchStub(() => ({
      status: 400,
      body: graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 1487390 }),
    }));

    const result = await createCreative("act_1", "tok", imageAd(), false);

    assert.ok("issues" in result);
    assert.equal(stub.calls.length, 1);
  });
});

describe("previewAd — mesma regra da criação real", () => {
  it("em conta sem IA valida o plano B e devolve o payload sem o campo", async () => {
    const s = stubIneligibleAccount();

    const preview = await previewAd(imageAd());

    assert.equal(preview.ok, true);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls.every((c) => c.isValidateOnly), true);
    assert.ok(preview.ok && !("degrees_of_freedom_spec" in preview.payload));
  });

  it("em conta elegível o payload da prévia traz a expansão", async () => {
    stub = installMetaFetchStub(() => ({ body: { success: true } }));

    const preview = await previewAd(imageAd());

    assert.equal(preview.ok, true);
    assert.ok(preview.ok);
    const spec = JSON.parse(preview.payload.degrees_of_freedom_spec);
    assert.equal(spec.creative_features_spec.image_uncrop.enroll_status, "OPT_IN");
  });

  it("outro erro na prévia é reportado sem nova tentativa", async () => {
    stub = installMetaFetchStub(() => ({
      status: 400,
      body: graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 1487390 }),
    }));

    const preview = await previewAd(imageAd());

    assert.equal(preview.ok, false);
    assert.equal(stub.calls.length, 1);
  });
});
