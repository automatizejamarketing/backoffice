import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureMetaTestEnv, installMetaFetchStub } from "@/tests/helpers/meta-fetch-stub";
import { getPromotionLinkDetails } from "./promotion-link-edit";

ensureMetaTestEnv();
for (const [name, creative] of Object.entries({
  post: { object_id: "p", instagram_user_id: "ig2", source_instagram_media_id: "post" },
  image: { object_story_spec: { page_id: "p", instagram_user_id: "ig2", link_data: { link: "https://example.com" } } },
  video: { object_story_spec: { page_id: "p", instagram_user_id: "ig2", video_data: { video_id: "video" } } },
})) {
  test(`creative edit preserves the original ${name} Page, Instagram and adset`, async () => {
    const stub = installMetaFetchStub(req => ({ body: req.path === "ad" ? {
      id: "ad", adset_id: "adset", creative: { id: "creative" }, campaign: { objective: "OUTCOME_TRAFFIC" },
    } : { id: "creative", ...creative } }));
    try {
      const details = await getPromotionLinkDetails({ adId: "ad", accessToken: `test-token-${name}` });
      assert.equal(details.pageId, "p");
      assert.equal(details.instagramUserId, "ig2");
      assert.equal(details.adsetId, "adset");
      assert.ok(stub.calls.every(c => c.method === "GET"));
    } finally { stub.restore(); }
  });
}
