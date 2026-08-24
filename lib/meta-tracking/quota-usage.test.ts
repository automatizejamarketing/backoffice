import { describe, expect, test } from "bun:test";

import {
  mergeQuotaUsage,
  QUOTA_STOP_THRESHOLD_PERCENT,
  readQuotaUsage,
  shouldStopForAppQuota,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
} from "@/lib/meta-tracking/quota-usage";

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("readQuotaUsage", () => {
  test("resposta sem header de uso não diz nada sobre a cota", () => {
    const usage = readQuotaUsage(headersOf({}));

    expect(usage.utilizationPercent).toBeNull();
    expect(usage.estimatedRegainMs).toBeNull();
    expect(shouldStopForQuota(usage)).toBe(false);
  });

  test("X-Business-Use-Case-Usage: pega o pior entre chamadas, CPU e tempo", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-business-use-case-usage": JSON.stringify({
          "998877665544332": [
            {
              type: "ads_management",
              call_count: 12,
              total_cputime: 84,
              total_time: 30,
              estimated_time_to_regain_access: 0,
            },
          ],
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(84);
  });

  test("X-Business-Use-Case-Usage: pega o pior entre as contas do header", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-business-use-case-usage": JSON.stringify({
          "111": [{ type: "ads_management", call_count: 10 }],
          "222": [{ type: "ads_insights", call_count: 91 }],
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(91);
  });

  test("estimated_time_to_regain_access vem em minutos e sai em ms", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-business-use-case-usage": JSON.stringify({
          "111": [
            {
              type: "ads_management",
              call_count: 100,
              estimated_time_to_regain_access: 7,
            },
          ],
        }),
      }),
    );

    expect(usage.estimatedRegainMs).toBe(7 * 60_000);
  });

  test("X-FB-Ads-Insights-Throttle conta como utilização", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-fb-ads-insights-throttle": JSON.stringify({
          app_id_util_pct: 3.5,
          acc_id_util_pct: 92.25,
          ads_api_access_tier: "development_access",
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(92.25);
    expect(usage.appUtilizationPercent).toBe(3.5);
    expect(shouldStopForQuota(usage)).toBe(true);
    expect(shouldStopForAppQuota(usage)).toBe(false);
  });

  test("X-Ad-Account-Usage também é lido", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-ad-account-usage": JSON.stringify({
          acc_id_util_pct: 81,
          reset_time_duration: 120,
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(81);
    expect(usage.estimatedRegainMs).toBe(120_000);
  });

  test("X-App-Usage preserva o escopo global em vez de parecer cota da conta", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-app-usage": JSON.stringify({
          call_count: 82,
          total_cputime: 35,
          total_time: 20,
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(82);
    expect(usage.appUtilizationPercent).toBe(82);
    expect(shouldStopForAppQuota(usage)).toBe(true);
  });

  test("BUC alto continua restrito à conta", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-business-use-case-usage": JSON.stringify({
          "998877665544332": [{ call_count: 91 }],
        }),
      }),
    );

    expect(usage.utilizationPercent).toBe(91);
    expect(usage.appUtilizationPercent).toBeUndefined();
    expect(shouldStopForQuota(usage)).toBe(true);
    expect(shouldStopForAppQuota(usage)).toBe(false);
  });

  test("header malformado é ignorado em vez de derrubar a coleta", () => {
    const usage = readQuotaUsage(
      headersOf({
        "x-business-use-case-usage": "isto não é json",
        "x-app-usage": JSON.stringify({ call_count: 42 }),
      }),
    );

    expect(usage.utilizationPercent).toBe(42);
  });
});

describe("shouldStopForQuota", () => {
  test("abaixo do limiar a conta segue sendo coletada", () => {
    expect(
      shouldStopForQuota({
        utilizationPercent: QUOTA_STOP_THRESHOLD_PERCENT - 0.1,
        estimatedRegainMs: null,
      }),
    ).toBe(false);
  });

  test("no limiar já interrompe — a parada é preventiva, não reativa", () => {
    expect(
      shouldStopForQuota({
        utilizationPercent: QUOTA_STOP_THRESHOLD_PERCENT,
        estimatedRegainMs: null,
      }),
    ).toBe(true);
  });

  test("bloqueio já anunciado pela Meta interrompe mesmo sem percentual", () => {
    expect(
      shouldStopForQuota({
        utilizationPercent: null,
        estimatedRegainMs: 60_000,
      }),
    ).toBe(true);
  });

  test("cota desconhecida não interrompe — só o que a Meta disse conta", () => {
    expect(shouldStopForQuota(UNKNOWN_QUOTA_USAGE)).toBe(false);
  });
});

describe("mergeQuotaUsage", () => {
  test("a pior leitura da conta é a que vale", () => {
    const merged = mergeQuotaUsage(
      { utilizationPercent: 30, estimatedRegainMs: null },
      { utilizationPercent: 77, estimatedRegainMs: 5_000 },
    );

    expect(merged).toEqual({ utilizationPercent: 77, estimatedRegainMs: 5_000 });
  });

  test("leitura desconhecida não apaga o que já se sabia", () => {
    const merged = mergeQuotaUsage(
      { utilizationPercent: 55, estimatedRegainMs: 1_000 },
      UNKNOWN_QUOTA_USAGE,
    );

    expect(merged).toEqual({ utilizationPercent: 55, estimatedRegainMs: 1_000 });
  });

  test("a pior leitura global sobrevive ao merge", () => {
    const merged = mergeQuotaUsage(
      {
        utilizationPercent: 81,
        estimatedRegainMs: null,
        appUtilizationPercent: 81,
      },
      {
        utilizationPercent: 92,
        estimatedRegainMs: null,
        appUtilizationPercent: 40,
      },
    );

    expect(merged).toEqual({
      utilizationPercent: 92,
      estimatedRegainMs: null,
      appUtilizationPercent: 81,
    });
  });
});
