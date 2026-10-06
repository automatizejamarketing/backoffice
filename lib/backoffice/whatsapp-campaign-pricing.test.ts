import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchCampaignPricing } from "./whatsapp-campaign-pricing";

describe("Meta public reference pricing", () => {
  it("queries Brazil marketing in BRL and preserves sub-cent precision", async () => {
    const request = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "whatsappbusiness.com");
      if (!url.pathname.includes('/wp-json/')) return new Response('{"restNonce":"public-test"}');
      assert.equal(url.searchParams.get('market'),'BR');
      assert.equal(url.searchParams.get('currency'),'BRL');
      assert.equal(url.searchParams.get('category'),'Marketing');
      assert.equal(url.searchParams.get('_wab_nonce'),'public-test');
      return Response.json({quote:'0.3217'});
    }) as typeof fetch;
    assert.equal((await fetchCampaignPricing(request)).unitCostMicros,321700);
  });
  it("does not invent a price when the source is unavailable or malformed", async () => {
    for (const quote of ['0.0000','NaN','-0.30',null,'9999999999999.00']) {
      const request = (async (url: string | URL | Request) => String(url).includes('/wp-json/') ? Response.json({quote}) : new Response('{"restNonce":"public-test"}')) as typeof fetch;
      await assert.rejects(fetchCampaignPricing(request));
    }
    await assert.rejects(fetchCampaignPricing((async () => new Response('',{status:503})) as typeof fetch));
    await assert.rejects(fetchCampaignPricing((async () => new Response('changed markup')) as typeof fetch));
  });
});
