import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { adsManagerAdUrl, adsManagerCampaignUrl, adsManagerCampaignsUrl, bareAccountId } from "./ads-manager";

mock.module("server-only", () => ({}));
const { frameSrc, toPreview } = await import("./creative-previews");

describe("links do Gerenciador", () => {
  it("tira o act_ e monta campanhas e anúncio", () => {
    assert.equal(bareAccountId("act_1237965104926610"), "1237965104926610");
    assert.equal(
      adsManagerCampaignsUrl("act_1237965104926610"),
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1237965104926610",
    );
    assert.equal(
      adsManagerAdUrl("1237965104926610", "120249329863440575"),
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=1237965104926610&selected_ad_ids=120249329863440575",
    );
  });

  it("campanha abre os conjuntos dela", () => {
    assert.equal(
      adsManagerCampaignUrl("act_1237965104926610", "120249329863300575"),
      "https://adsmanager.facebook.com/adsmanager/manage/adsets?act=1237965104926610&selected_campaign_ids=120249329863300575",
    );
  });

  it("recusa id que não é número", () => {
    assert.equal(adsManagerCampaignsUrl(null), null);
    assert.equal(adsManagerCampaignsUrl("act_abc"), null);
    assert.equal(adsManagerAdUrl("act_123456", "1&x=2"), null);
  });
});

describe("prévia do creative", () => {
  it("vídeo: miniatura, texto e destino do object_story_spec", () => {
    const preview = toPreview("1", {
      thumbnail_url: "https://scontent.fbcdn.net/t.jpg",
      video_id: "99",
      object_story_spec: {
        video_data: { message: "Peça já", title: "Almoço", call_to_action: { type: "ORDER_NOW", value: { link: "https://pedido.exemplo" } } },
      },
    });
    assert.equal(preview.thumbnailUrl, "https://scontent.fbcdn.net/t.jpg");
    assert.equal(preview.videoId, "99");
    assert.equal(preview.body, "Peça já");
    assert.equal(preview.title, "Almoço");
    assert.equal(preview.link, "https://pedido.exemplo");
    assert.equal(preview.callToAction, "ORDER_NOW");
  });

  it("Advantage+: imagem, texto e vídeo do asset_feed_spec", () => {
    const preview = toPreview("2", {
      asset_feed_spec: {
        images: [{ url: "https://img/1.jpg" }],
        bodies: [{ text: "Texto 1" }],
        titles: [{ text: "Título 1" }],
        videos: [{ video_id: "7", thumbnail_url: "https://thumb/7.jpg" }],
        link_urls: [{ website_url: "https://site" }],
        call_to_action_types: ["SHOP_NOW"],
      },
    });
    assert.deepEqual(
      [preview.thumbnailUrl, preview.imageUrl, preview.videoId, preview.body, preview.title, preview.link, preview.callToAction],
      ["https://thumb/7.jpg", "https://img/1.jpg", "7", "Texto 1", "Título 1", "https://site", "SHOP_NOW"],
    );
  });

  it("sem creative não quebra", () => {
    assert.equal(toPreview("3", undefined).thumbnailUrl, null);
  });
});

describe("iframe de prévia", () => {
  it("extrai o src e desfaz o &amp;", () => {
    const html = '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&amp;t=AQ2" width="335"></iframe>';
    assert.equal(frameSrc(html), "https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&t=AQ2");
  });

  it("só aceita facebook.com por https", () => {
    assert.equal(frameSrc('<iframe src="https://evil.com/x"></iframe>'), null);
    assert.equal(frameSrc('<iframe src="http://www.facebook.com/x"></iframe>'), null);
    assert.equal(frameSrc('<iframe src="https://notfacebook.com/x"></iframe>'), null);
    assert.equal(frameSrc(undefined), null);
  });
});
