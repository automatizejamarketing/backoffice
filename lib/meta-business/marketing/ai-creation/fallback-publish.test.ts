import { describe, expect, test } from "bun:test";

import { resolveFallbackConfig, type FallbackNiche } from "./fallback-publish";

const NICHES: FallbackNiche[] = [
  "food_service",
  "retail",
  "real_estate_broker",
  "service",
  "insurance_broker",
  "outros",
];

describe("resolveFallbackConfig WhatsApp", () => {
  test("every niche can publish a WhatsApp sales campaign", () => {
    for (const niche of NICHES) {
      const config = resolveFallbackConfig(niche, "whatsapp");
      expect("error" in config).toBe(false);
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
