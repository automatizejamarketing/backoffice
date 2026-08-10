import { describe, expect, test } from "bun:test";
import {
  getAlertDefinition,
  PROACTIVITY_ALERT_DEFINITIONS,
  seedRowsFromCatalog,
  validateAlertChannels,
  validateAlertThresholds,
} from "./catalog";

describe("proactivity catalog", () => {
  test("has unique ruleKey+audience pairs", () => {
    const keys = PROACTIVITY_ALERT_DEFINITIONS.map(
      (def) => `${def.ruleKey}:${def.audience}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("seed rows cover every definition", () => {
    const seeds = seedRowsFromCatalog();
    expect(seeds.length).toBe(PROACTIVITY_ALERT_DEFINITIONS.length);
    for (const seed of seeds) {
      expect(seed.enabled).toBe(true);
      expect(seed.deliverWhatsapp).toBe(false);
      expect(seed.deliverSlack).toBe(false);
    }
  });

  test("validateAlertChannels rejects cross-audience extras", () => {
    expect(() =>
      validateAlertChannels({
        audience: "client",
        deliverWhatsapp: true,
        deliverSlack: true,
      }),
    ).toThrow("invalid_deliver_slack_for_client");

    expect(() =>
      validateAlertChannels({
        audience: "consultant",
        deliverWhatsapp: true,
        deliverSlack: false,
      }),
    ).toThrow("invalid_deliver_whatsapp_for_consultant");
  });

  test("validateAlertThresholds accepts known fields and rejects unknown", () => {
    const def = getAlertDefinition("campaign_stalled", "consultant");
    expect(def).toBeDefined();
    const ok = validateAlertThresholds(def!, {
      stalledPausedDays: 3,
      minSpendForStalled: 40,
    });
    expect(ok.stalledPausedDays).toBe(3);
    expect(ok.minSpendForStalled).toBe(40);

    expect(() =>
      validateAlertThresholds(def!, {
        stalledPausedDays: 3,
        minSpendForStalled: 40,
        extra: 1,
      }),
    ).toThrow("unknown_threshold_extra");
  });

  test("client and consultant stalled can have independent defaults", () => {
    const client = getAlertDefinition("campaign_stalled", "client");
    const consultant = getAlertDefinition("campaign_stalled", "consultant");
    expect(client?.audience).toBe("client");
    expect(consultant?.audience).toBe("consultant");
    expect(client?.clientRuleId).toBe("campaign_stalled");
    expect(consultant?.playbookRuleId).toBe("playbook.campaign_stalled");
  });
});
