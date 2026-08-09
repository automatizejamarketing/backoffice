import { describe, expect, test } from "bun:test";

import {
  hashTrackedConfig,
  normalizeTrackedConfig,
  projectVersionColumns,
  projectVolatileColumns,
} from "@/lib/meta-tracking/config-version";
import {
  adConfigV25,
  adsetConfigV25,
  campaignConfigV25,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_CREATIVE_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

describe("normalizeTrackedConfig + hashTrackedConfig", () => {
  test("a mesma configuração produz o mesmo hash em qualquer ordem de chaves", () => {
    const asReturned = campaignConfigV25();
    const reordered = Object.fromEntries(
      Object.entries(asReturned).reverse(),
    ) as Record<string, unknown>;

    expect(hashTrackedConfig(normalizeTrackedConfig(reordered))).toBe(
      hashTrackedConfig(normalizeTrackedConfig(asReturned)),
    );
  });

  test("campo volátil que anda sozinho não muda o hash", () => {
    const before = hashTrackedConfig(
      normalizeTrackedConfig(adsetConfigV25()),
    );
    const after = hashTrackedConfig(
      normalizeTrackedConfig(
        adsetConfigV25({
          effective_status: "CAMPAIGN_PAUSED",
          budget_remaining: "1234",
          learning_stage_info: { status: "SUCCESS", conversions: 51 },
          updated_time: "2026-08-09T04:00:00-0300",
        }),
      ),
    );

    expect(after).toBe(before);
  });

  test("mudança real de configuração muda o hash", () => {
    const before = hashTrackedConfig(
      normalizeTrackedConfig(campaignConfigV25()),
    );
    const after = hashTrackedConfig(
      normalizeTrackedConfig(campaignConfigV25({ daily_budget: "9000" })),
    );

    expect(after).not.toBe(before);
  });

  test("a normalizada não carrega volátil nem edge devolvido junto", () => {
    const normalized = normalizeTrackedConfig(
      campaignConfigV25({
        insights: { data: [{ spend: "12.34" }] },
        adsets: { data: [{ id: "120250000000000201", status: "PAUSED" }] },
      }),
    );

    expect(Object.keys(normalized)).not.toContain("effective_status");
    expect(Object.keys(normalized)).not.toContain("budget_remaining");
    expect(Object.keys(normalized)).not.toContain("updated_time");
    expect(Object.keys(normalized)).not.toContain("insights");
    expect(Object.keys(normalized)).not.toContain("adsets");
    expect(normalized.daily_budget).toBe("5000");
  });
});

describe("projectVersionColumns", () => {
  test("campanha: colunas quentes, orçamento em unidades menores e modo derivado", () => {
    const columns = projectVersionColumns("campaign", campaignConfigV25());

    expect(columns.entityName).toBe("[AM][VENDAS][FS][2026-06-18-19-22-53]");
    expect(columns.configuredStatus).toBe("ACTIVE");
    expect(columns.objective).toBe("OUTCOME_SALES");
    expect(columns.buyingType).toBe("AUCTION");
    expect(columns.bidStrategy).toBe("LOWEST_COST_WITHOUT_CAP");
    // Unidades MENORES, como a Meta devolve: "5000" = R$ 50,00.
    expect(columns.dailyBudget).toBe("5000");
    expect(columns.lifetimeBudget).toBeNull();
    expect(columns.spendCap).toBe("92233720368547758");
    expect(columns.smartPromotionType).toBe("GUIDED_CREATION");
    expect(columns.advantageState).toBe("ADVANTAGE_PLUS_SALES");
    expect(columns.isAdsetBudgetSharingEnabled).toBe(true);
    expect(columns.budgetMode).toBe("CBO");
    expect(columns.createdTimeMeta).toEqual(
      new Date("2026-06-18T19:22:53-0300"),
    );
    expect(columns.startTime).toEqual(new Date("2026-06-18T19:22:53-0300"));
    // stop_time da campanha ocupa a mesma coluna de fim do end_time do conjunto.
    expect(columns.endTime).toEqual(new Date("2026-09-18T23:59:59-0300"));
    // Colunas de outro nível ficam nulas.
    expect(columns.optimizationGoal).toBeNull();
    expect(columns.creativeId).toBeNull();
    expect(columns.campaignId).toBeNull();
  });

  test("campanha sem orçamento próprio é ABO", () => {
    const columns = projectVersionColumns(
      "campaign",
      campaignConfigV25({ daily_budget: "0", lifetime_budget: "0" }),
    );

    expect(columns.budgetMode).toBe("ABO");
    expect(columns.dailyBudget).toBeNull();
  });

  test("conjunto: metas, lance, segmentação e hierarquia desnormalizada", () => {
    const columns = projectVersionColumns("adset", adsetConfigV25());

    expect(columns.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(columns.adsetId).toBeNull();
    expect(columns.optimizationGoal).toBe("OFFSITE_CONVERSIONS");
    expect(columns.billingEvent).toBe("IMPRESSIONS");
    expect(columns.bidAmount).toBe("1500");
    expect(columns.destinationType).toBe("WEBSITE");
    expect(columns.isDynamicCreative).toBe(false);
    expect(
      (columns.targeting as { age_min?: number } | null)?.age_min,
    ).toBe(25);
    expect(
      (columns.promotedObject as { pixel_id?: string } | null)?.pixel_id,
    ).toBe("1122334455667788");
    expect(columns.attributionSpec).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]);
    expect(columns.pacingType).toEqual(["standard"]);
    expect(columns.endTime).toEqual(new Date("2026-07-18T23:59:59-0300"));
    expect(columns.objective).toBeNull();
    expect(columns.budgetMode).toBeNull();
  });

  test("anúncio: criativo referenciado, domínio de conversão e hierarquia", () => {
    const columns = projectVersionColumns("ad", adConfigV25());

    expect(columns.creativeId).toBe(FIXTURE_CREATIVE_ID);
    expect(columns.conversionDomain).toBe("loja.exemplo.com.br");
    expect(columns.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(columns.adsetId).toBe(FIXTURE_ADSET_ID);
    expect(columns.trackingSpecs).toEqual([
      { "action.type": ["offsite_conversion"], fb_pixel: ["1122334455667788"] },
    ]);
    expect(columns.targeting).toBeNull();
  });
});

describe("projectVolatileColumns", () => {
  test("separa o que muda sozinho — é o que a confirmação atualiza sem versão nova", () => {
    const volatiles = projectVolatileColumns(
      adsetConfigV25({
        effective_status: "CAMPAIGN_PAUSED",
        budget_remaining: "1234",
      }),
    );

    expect(volatiles.effectiveStatus).toBe("CAMPAIGN_PAUSED");
    expect(volatiles.budgetRemaining).toBe("1234");
    expect(
      (volatiles.learningStageInfo as { status?: string } | null)?.status,
    ).toBe("LEARNING");
    expect(volatiles.updatedTimeMeta).toEqual(
      new Date("2026-08-01T10:12:45-0300"),
    );
    expect(volatiles.issuesInfo).toBeNull();
  });
});
