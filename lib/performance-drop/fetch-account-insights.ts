import { metaApiCall } from "@/lib/meta-business/api";
import { transformInsightsData } from "@/lib/meta-business/transformers";
import type {
  GraphApiInsights,
  InsightsMetrics,
  TimeRange,
} from "@/lib/meta-business/types";
import {
  aggregateWindowMetrics,
  emptyWindowMetrics,
  type WindowMetrics,
} from "@/lib/performance-drop/evaluate";
import { previousSevenDayRange } from "@/lib/performance-drop/dates";

const INSIGHTS_FIELDS = [
  "spend",
  "impressions",
  "actions",
  "action_values",
  "purchase_roas",
  "website_purchase_roas",
  "date_start",
  "date_stop",
].join(",");

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function parseMetricNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function insightsToWindowMetrics(
  insights: InsightsMetrics | undefined,
): WindowMetrics {
  if (!insights) return emptyWindowMetrics();

  const spend = parseMetricNumber(insights.spend);
  const purchases = parseMetricNumber(insights.purchaseCount);
  let purchaseValue = parseMetricNumber(insights.purchaseValue);

  // Fall back to ROAS × spend when action_values are missing.
  if (purchaseValue <= 0 && spend > 0) {
    const roas = parseMetricNumber(
      insights.purchaseRoas ?? insights.websitePurchaseRoas,
    );
    if (roas > 0) purchaseValue = roas * spend;
  }

  return {
    spend,
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
  };
}

async function fetchInsightsRow(args: {
  accessToken: string;
  accountId: string;
  datePreset?: "last_7d";
  timeRange?: TimeRange;
}): Promise<InsightsMetrics | undefined> {
  const path = `${formatAccountId(args.accountId)}/insights`;
  const params = new URLSearchParams({
    fields: INSIGHTS_FIELDS,
    level: "account",
  });

  if (args.datePreset) {
    params.set("date_preset", args.datePreset);
  } else if (args.timeRange) {
    params.set("time_range", JSON.stringify(args.timeRange));
  }

  const response = await metaApiCall<{ data?: GraphApiInsights[] }>({
    method: "GET",
    path,
    params: params.toString(),
    accessToken: args.accessToken,
  });

  const row = response.data?.[0];
  if (!row) return undefined;
  return transformInsightsData(row);
}

export type AccountWindowPair = {
  accountId: string;
  accountName: string | null;
  current: WindowMetrics;
  previous: WindowMetrics;
  currentRange: { since: string; until: string } | null;
  previousRange: { since: string; until: string } | null;
};

/**
 * Fetches account-level insights for Meta's `last_7d` and the preceding 7 days.
 */
export async function fetchAccountWindowPair(args: {
  accessToken: string;
  accountId: string;
  accountName?: string | null;
}): Promise<AccountWindowPair> {
  const currentInsights = await fetchInsightsRow({
    accessToken: args.accessToken,
    accountId: args.accountId,
    datePreset: "last_7d",
  });

  const current = insightsToWindowMetrics(currentInsights);
  const since = currentInsights?.dateStart;
  const until = currentInsights?.dateStop;

  let previous = emptyWindowMetrics();
  let previousRange: { since: string; until: string } | null = null;
  let currentRange: { since: string; until: string } | null = null;

  if (since && until) {
    currentRange = { since, until };
    previousRange = previousSevenDayRange(currentRange);
    const previousInsights = await fetchInsightsRow({
      accessToken: args.accessToken,
      accountId: args.accountId,
      timeRange: previousRange,
    });
    previous = insightsToWindowMetrics(previousInsights);
  }

  return {
    accountId: formatAccountId(args.accountId),
    accountName: args.accountName ?? null,
    current,
    previous,
    currentRange,
    previousRange,
  };
}

export function aggregateAccountPairs(pairs: AccountWindowPair[]): {
  current: WindowMetrics;
  previous: WindowMetrics;
} {
  return {
    current: aggregateWindowMetrics(pairs.map((p) => p.current)),
    previous: aggregateWindowMetrics(pairs.map((p) => p.previous)),
  };
}
