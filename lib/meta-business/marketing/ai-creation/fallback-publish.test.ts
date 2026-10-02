import { describe, expect, test } from "bun:test";

import {
  ensureMetaTestEnv,
  installMetaFetchStub,
  type MetaRequest,
} from "@/tests/helpers/meta-fetch-stub";
import {
  publishFallbackCampaign,
  resolveFallbackConfig,
  type FallbackNiche,
} from "./fallback-publish";

ensureMetaTestEnv();

const PAGE_ID = "573247663171509";
const AUTOFILL = "Oi! Quero o rodízio.";

function requireCreate(calls: MetaRequest[], suffix: string): MetaRequest {
  const match = calls.find(
    (call) =>
      call.method === "POST" &&
      call.path.endsWith(suffix) &&
      !call.isValidateOnly,
  );
  if (!match) throw new Error(`expected a real POST ${suffix}`);
  return match;
}

const NICHES: FallbackNiche[] = [
  "food_service",
  "retail",
  "real_estate_broker",
  "service",
  "insurance_broker",
  "outros",
];

describe("resolveFallbackConfig WhatsApp", () => {
  test("food service alone has the shared WhatsApp fallback preset", () => {
    for (const niche of NICHES) {
      const config = resolveFallbackConfig(niche, "whatsapp");
      expect("error" in config).toBe(niche !== "food_service");
      if ("error" in config) continue;
      expect(config.metaObjective).toBe("OUTCOME_ENGAGEMENT");
      expect(config.isWhatsapp).toBe(true);
      expect(config.requiresPixel).toBe(false);
      expect(config.requiresPromotionUrl).toBe(false);
      expect(config.acceptsDeliverySchedule).toBe(true);
    }
  });

  test("sales stays limited to food service, retail and outros", () => {
    const blocked = resolveFallbackConfig("real_estate_broker", "sales");
    expect("error" in blocked).toBe(true);

    const allowed = resolveFallbackConfig("outros", "sales");
    expect("error" in allowed).toBe(false);
    if ("error" in allowed) return;
    expect(allowed.metaObjective).toBe("OUTCOME_SALES");
  });
});

describe("publishFallbackCampaign com a liberação da etapa 2", () => {
  test("campanha nasce programada e o conjunto leva só a grade (24h x 7 no dia todo)", async () => {
    const previous = process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
    process.env.META_CBO_DAYPARTING_ACCOUNT_IDS = "act_1";
    const stub = installMetaFetchStub((req) => {
      if (req.method === "GET") return { body: { data: [] } };
      if (req.path.endsWith("/campaigns")) return { body: { id: "camp_dp" } };
      if (req.path.endsWith("/adsets")) return { body: { id: "adset_dp" } };
      if (req.path.endsWith("/adcreatives")) return { body: { id: "creative_dp" } };
      if (req.path.endsWith("/ads")) return { body: { id: "ad_dp" } };
      return { body: { success: true, id: req.path } };
    });
    try {
      const published = await publishFallbackCampaign({
        adAccountId: "act_1",
        accessToken: "tok-dp-fallback",
        input: {
          niche: "food_service",
          objective: "whatsapp",
          dailyBudget: 30,
          pageId: PAGE_ID,
          media: [{ kind: "video", videoId: "vid_1" }],
          texts: { headline: "Rodízio", message: "Venha conhecer" },
          locations: [{ key: "BR", name: "Brasil", type: "country" }],
          whatsappWelcome: { autofillMessage: AUTOFILL },
        },
      });
      expect(published.ok).toBe(true);
      const campaign = requireCreate(stub.calls, "/campaigns");
      expect(campaign.params.get("pacing_type")).toBe(JSON.stringify(["day_parting"]));
      const adSet = requireCreate(stub.calls, "/adsets");
      expect(adSet.params.has("pacing_type")).toBe(false);
      expect(JSON.parse(adSet.params.get("adset_schedule") ?? "null")).toEqual([
        { days: [0, 1, 2, 3, 4, 5, 6], start_minute: 0, end_minute: 1440 },
      ]);
    } finally {
      stub.restore();
      if (previous === undefined) delete process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
      else process.env.META_CBO_DAYPARTING_ACCOUNT_IDS = previous;
    }
  });
});

describe("publishFallbackCampaign sem a liberação da etapa 2", () => {
  test("CBO vitalícia com horários específicos: formato da etapa 1 (pacing + grade no conjunto)", async () => {
    const previous = process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
    delete process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
    const stub = installMetaFetchStub((req) => {
      if (req.method === "GET") return { body: { data: [] } };
      if (req.path.endsWith("/campaigns")) return { body: { id: "camp_s1" } };
      if (req.path.endsWith("/adsets")) return { body: { id: "adset_s1" } };
      if (req.path.endsWith("/adcreatives")) return { body: { id: "creative_s1" } };
      if (req.path.endsWith("/ads")) return { body: { id: "ad_s1" } };
      return { body: { success: true, id: req.path } };
    });
    try {
      const published = await publishFallbackCampaign({
        adAccountId: "act_1",
        accessToken: "tok-s1-fallback",
        input: {
          niche: "food_service",
          objective: "whatsapp",
          dailyBudget: 30,
          pageId: PAGE_ID,
          media: [{ kind: "video", videoId: "vid_1" }],
          texts: { headline: "Rodízio", message: "Venha conhecer" },
          locations: [{ key: "BR", name: "Brasil", type: "country" }],
          whatsappWelcome: { autofillMessage: AUTOFILL },
          deliveryMode: "specific_hours",
          scheduleBlocks: [{ days: [1, 2], startMinute: 1080, endMinute: 1380 }],
        },
      });
      expect(published.ok).toBe(true);
      const campaign = requireCreate(stub.calls, "/campaigns");
      expect(campaign.params.has("pacing_type")).toBe(false);
      expect(campaign.params.has("lifetime_budget")).toBe(true);
      const adSet = requireCreate(stub.calls, "/adsets");
      expect(adSet.params.get("pacing_type")).toBe(JSON.stringify(["day_parting"]));
      expect(JSON.parse(adSet.params.get("adset_schedule") ?? "null")).toEqual([
        { days: [1, 2], start_minute: 1080, end_minute: 1380, timezone_type: "ADVERTISER" },
      ]);
    } finally {
      stub.restore();
      if (previous === undefined) delete process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
      else process.env.META_CBO_DAYPARTING_ACCOUNT_IDS = previous;
    }
  });
});
