import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_PLACEMENT_ADAPTATION,
  buildDegreesOfFreedomSpec,
} from "../lib/meta-business/creative-features";
import {
  createAdCreativeFromInstagramPost,
  createDynamicVideoAdCreative,
  createVideoAdCreative,
} from "../lib/meta-business/marketing/creative-builders";
import { updatePromotionLink } from "../lib/meta-business/marketing/promotion-link-edit";
import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaFetchStub,
  type MetaRequest,
} from "./helpers/meta-fetch-stub";

/**
 * "Novo anúncio" em conjunto existente e troca de link também pedem a expansão
 * sem corte (regra de 30/09/2026). Imagem não entra porque o upload baixa a URL
 * de verdade; o envio é o mesmo `postAdCreativeForm`.
 */

ensureMetaTestEnv();

const EXPANSION = JSON.stringify(buildDegreesOfFreedomSpec(DEFAULT_PLACEMENT_ADAPTATION));
const INELIGIBLE = graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 3858023 });

let stub: MetaFetchStub | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

function meta(opts: { ineligible?: boolean } = {}): MetaFetchStub {
  stub = installMetaFetchStub((req: MetaRequest) => {
    if (req.method === "POST" && req.path === "act_1/adcreatives") {
      if (opts.ineligible && req.params.get("degrees_of_freedom_spec")) {
        return { status: 400, body: INELIGIBLE };
      }
      return { body: { id: "cr_new" } };
    }
    if (req.method === "GET" && req.path === "ad_1") {
      return {
        body: {
          id: "ad_1",
          name: "Anúncio",
          adset_id: "as_1",
          campaign_id: "camp_1",
          campaign: { id: "camp_1", objective: "OUTCOME_SALES" },
          creative: { id: "cr_old" },
        },
      };
    }
    if (req.method === "GET" && req.path === "cr_old") {
      return {
        body: {
          id: "cr_old",
          name: "Criativo",
          object_story_spec: {
            page_id: "page_1",
            link_data: {
              link: "https://antigo.example",
              image_hash: "H",
              call_to_action: { type: "SHOP_NOW", value: { link: "https://antigo.example" } },
            },
          },
        },
      };
    }
    if (req.method === "POST" && req.path === "ad_1") return { body: { success: true } };
    return { status: 500, body: graphErrorBody({ message: `unexpected ${req.method} ${req.path}` }) };
  });
  return stub;
}

const creativePosts = (s: MetaFetchStub) =>
  s.calls.filter((c) => c.method === "POST" && c.path === "act_1/adcreatives");

const BUILDERS: Array<{ name: string; run: () => Promise<{ id: string }> }> = [
  {
    name: "post do Instagram",
    run: () =>
      createAdCreativeFromInstagramPost({
        adAccountId: "act_1",
        accessToken: "tok",
        name: "Criativo",
        instagramMediaId: "ig_media_1",
        pageId: "page_1",
        instagramAccountId: "ig_1",
        url: "https://loja.example",
      }),
  },
  {
    name: "vídeo",
    run: () =>
      createVideoAdCreative({
        adAccountId: "act_1",
        accessToken: "tok",
        name: "Criativo",
        pageId: "page_1",
        instagramAccountId: "ig_1",
        url: "https://loja.example",
        videoId: "video_1",
        thumbnailUrl: "https://cdn.example/thumb.jpg",
      }),
  },
  {
    name: "vídeo dinâmico",
    run: () =>
      createDynamicVideoAdCreative({
        adAccountId: "act_1",
        accessToken: "tok",
        name: "Criativo",
        pageId: "page_1",
        instagramAccountId: "ig_1",
        url: "https://loja.example",
        videoId: "video_1",
        thumbnailUrl: "https://cdn.example/thumb.jpg",
        titles: ["Título"],
        texts: ["Texto"],
      }),
  },
];

for (const builder of BUILDERS) {
  describe(`novo anúncio — ${builder.name}`, () => {
    it("pede a expansão", async () => {
      const s = meta();
      assert.deepEqual(await builder.run(), { id: "cr_new" });
      const posts = creativePosts(s);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].params.get("degrees_of_freedom_spec"), EXPANSION);
    });

    it("conta sem IA: refaz uma vez sem o campo", async () => {
      const s = meta({ ineligible: true });
      assert.deepEqual(await builder.run(), { id: "cr_new" });
      const posts = creativePosts(s);
      assert.equal(posts.length, 2);
      assert.equal(posts[1].params.get("degrees_of_freedom_spec"), null);
    });
  });
}

describe("troca de link", () => {
  it("o criativo novo sai com a expansão e o link novo", async () => {
    const s = meta();

    const result = await updatePromotionLink({
      accountId: "act_1",
      adId: "ad_1",
      accessToken: "tok",
      promotionUrl: "https://novo.example",
    });

    assert.equal(result.creativeId, "cr_new");
    const posts = creativePosts(s);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].params.get("degrees_of_freedom_spec"), EXPANSION);
    assert.match(posts[0].params.get("object_story_spec") ?? "", /novo\.example/);
  });

  it("conta sem IA: refaz uma vez sem o campo", async () => {
    const s = meta({ ineligible: true });

    const result = await updatePromotionLink({
      accountId: "act_1",
      adId: "ad_1",
      accessToken: "tok",
      promotionUrl: "https://novo.example",
    });

    assert.equal(result.creativeId, "cr_new");
    const posts = creativePosts(s);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].params.get("degrees_of_freedom_spec"), null);
  });
});
