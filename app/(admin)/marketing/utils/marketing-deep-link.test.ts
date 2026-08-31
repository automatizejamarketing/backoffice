import { describe, expect, test } from "bun:test";

import {
  buildMarketingAdHref,
  parseMarketingDeepLink,
} from "./marketing-deep-link";

describe("buildMarketingAdHref", () => {
  test("opens marketing at the ad, stripping act_ from the account", () => {
    expect(
      buildMarketingAdHref({
        userId: "user-1",
        userEmail: "owner@example.com",
        accountId: "act_123",
        campaignId: "camp-1",
        adsetId: "adset-1",
        adId: "ad-1",
      }),
    ).toBe(
      "/marketing?userId=user-1&email=owner%40example.com&accountId=123&campaignId=camp-1&adsetId=adset-1&adId=ad-1",
    );
  });
});

describe("parseMarketingDeepLink", () => {
  test("reads adset and ad ids from the query string", () => {
    const params = new URLSearchParams(
      "accountId=123&campaignId=camp-1&adsetId=adset-1&adId=ad-1",
    );
    expect(parseMarketingDeepLink(params)).toMatchObject({
      accountId: "123",
      campaignId: "camp-1",
      adsetId: "adset-1",
      adId: "ad-1",
    });
  });
});
