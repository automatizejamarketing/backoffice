import "server-only";

import { listEnabledAdAccountIds } from "@/lib/backoffice/meta-enabled-assets";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { RESULT_FIELDS } from "@/lib/meta-business/insights/catalogs/metrics";
import { buildFilteringPart, callMeta } from "@/lib/meta-business/insights/client";
import { minorToMajor, round2 } from "@/lib/meta-business/insights/currency";
import { mapErrorKind } from "@/lib/meta-business/insights/envelope";
import { normalizeInsightRow, type RawInsight } from "@/lib/meta-business/insights/normalize";
import { paginate } from "@/lib/meta-business/insights/pagination";
import { cachedMetaRead, INSIGHTS_CACHE_TTL_MS, tokenCacheId } from "@/lib/meta-business/read-cache";
import { pickPlaybookAccounts, type PlaybookAccount } from "@/lib/playbook-insights/multi-account";
import { pctChange, type ComparedPeriods, type Period } from "./meta-ads-metrics";

/**
 * Live Meta read of ONE client (the consultant opened a client): campaigns, ad sets or ads
 * with the period and the previous one. Reads only; every Graph read goes through the 5-minute
 * read cache, so asking again about the same client does not spend Meta quota.
 */

export type CampaignLevel = "campaign" | "adset" | "ad";

const IDENTITY_FIELDS: Record<CampaignLevel, string[]> = {
  campaign: ["campaign_id", "campaign_name"],
  adset: ["adset_id", "adset_name", "campaign_id", "campaign_name"],
  ad: ["ad_id", "ad_name", "adset_name", "campaign_id", "campaign_name"],
};
const METRIC_FIELDS = ["objective", "spend", "impressions", "reach", "frequency", "cpc", "cpm", "ctr", ...RESULT_FIELDS];
const MAX_ROWS = 200;

type Ctx = { accessToken: string; accountId: string; currency: string };

async function fetchInsights(ctx: Ctx, level: CampaignLevel, period: Period, campaignId?: string) {
  return cachedMetaRead({
    key: `mcp:ins:${tokenCacheId(ctx.accessToken)}:${ctx.accountId}:${level}:${period.since}:${period.until}:${campaignId ?? ""}`,
    ttlMs: INSIGHTS_CACHE_TTL_MS,
    fetcher: () => paginate<RawInsight>(async after => {
      const parts = [
        `level=${level}`,
        `fields=${[...IDENTITY_FIELDS[level], ...METRIC_FIELDS].join(",")}`,
        `time_range=${encodeURIComponent(JSON.stringify(period))}`,
        "sort=spend_descending",
        "limit=100",
      ];
      if (campaignId && level !== "campaign") parts.push(buildFilteringPart([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]));
      if (after) parts.push(`after=${after}`);
      const res = await callMeta<{ data?: RawInsight[]; paging?: { cursors?: { after?: string }; next?: string } }>({
        domain: "FACEBOOK", method: "GET", path: `${ctx.accountId}/insights`, params: parts.join("&"), accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.next ? res.paging.cursors?.after : undefined };
    }, { maxRows: MAX_ROWS, maxPages: 2 }),
  });
}

type RawCampaign = { id: string; name?: string; objective?: string; daily_budget?: string; lifetime_budget?: string };

/** Active campaigns with their budget — the ones running even if they spent nothing yet. */
async function fetchActiveCampaigns(ctx: Ctx): Promise<RawCampaign[]> {
  return cachedMetaRead({
    key: `mcp:active-campaigns:${tokenCacheId(ctx.accessToken)}:${ctx.accountId}`,
    ttlMs: 2 * 60 * 1000,
    fetcher: async () => (await callMeta<{ data?: RawCampaign[] }>({
      domain: "FACEBOOK", method: "GET", path: `${ctx.accountId}/campaigns`, accessToken: ctx.accessToken,
      params: `fields=id,name,objective,daily_budget,lifetime_budget&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}&limit=100`,
    })).data ?? [],
  });
}

function summarize(raw: RawInsight | undefined, currency: string) {
  if (!raw) return null;
  const n = normalizeInsightRow(raw, { objective: typeof raw.objective === "string" ? raw.objective : null, currency });
  // Some accounts report purchase value but no purchase_roas; the warehouse derives it the same way.
  const roas = n.result.roas ?? (n.result.value && n.spend ? round2(n.result.value / n.spend) : null);
  return { ...n, result: { ...n.result, roas } };
}

function rowFor(level: CampaignLevel, cur: RawInsight | undefined, prev: RawInsight | undefined, currency: string) {
  const c = summarize(cur, currency);
  const p = summarize(prev, currency);
  const raw = (cur ?? prev ?? {}) as Record<string, unknown>;
  const str = (key: string) => (raw[key] == null ? undefined : String(raw[key]));
  return {
    id: str(`${level}_id`) ?? "",
    name: str(`${level}_name`) ?? null,
    ...(level !== "campaign" ? { campaign: str("campaign_name") ?? str("campaign_id") } : {}),
    ...(level === "ad" ? { adset: str("adset_name") } : {}),
    objective: str("objective") ?? null,
    spend: c?.spend ?? 0,
    result: c ? { label: c.result.label, count: c.result.count, costPerResult: c.result.costPerResult } : null,
    revenue: c?.result.value ?? null,
    roas: c?.result.roas ?? null,
    impressions: c?.impressions ?? 0,
    reach: c?.reach ?? null,
    frequency: c?.frequency ?? null,
    ctr: c?.ctr ?? null,
    cpc: c?.cpc ?? null,
    cpm: c?.cpm ?? null,
    previous: p ? { spend: p.spend, results: p.result.count, costPerResult: p.result.costPerResult, roas: p.result.roas } : null,
    change: {
      spend: pctChange(c?.spend ?? 0, p?.spend ?? null),
      results: pctChange(c?.result.count ?? 0, p?.result.count ?? null),
      costPerResult: pctChange(c?.result.costPerResult, p?.result.costPerResult),
      roas: pctChange(c?.result.roas, p?.result.roas),
    },
  };
}

export type ClientCampaignRow = ReturnType<typeof rowFor> & { account?: string; active?: boolean; dailyBudget?: number | null; lifetimeBudget?: number | null };

async function readAccount(args: { ctx: Ctx; level: CampaignLevel; periods: ComparedPeriods; campaignId?: string }) {
  const { ctx, level, periods, campaignId } = args;
  const [current, previous, active] = await Promise.all([
    fetchInsights(ctx, level, periods.current, campaignId),
    fetchInsights(ctx, level, periods.previous, campaignId),
    level === "campaign" ? fetchActiveCampaigns(ctx) : Promise.resolve(null),
  ]);
  const idOf = (r: RawInsight) => String((r as Record<string, unknown>)[`${level}_id`] ?? "");
  const prevById = new Map(previous.rows.map(r => [idOf(r), r]));
  const rows: ClientCampaignRow[] = current.rows.map(r => rowFor(level, r, prevById.get(idOf(r)), ctx.currency));
  const seen = new Set(rows.map(r => r.id));
  // Previous-only rows: whatever stopped spending this period.
  for (const r of previous.rows) if (!seen.has(idOf(r))) { rows.push(rowFor(level, undefined, r, ctx.currency)); seen.add(idOf(r)); }

  if (active) {
    const activeById = new Map(active.map(c => [c.id, c]));
    for (const row of rows) {
      const campaign = activeById.get(row.id);
      row.active = Boolean(campaign);
      if (campaign) Object.assign(row, { dailyBudget: minorToMajor(campaign.daily_budget), lifetimeBudget: minorToMajor(campaign.lifetime_budget) });
    }
    for (const campaign of active) {
      if (seen.has(campaign.id)) continue;
      rows.push({
        ...rowFor("campaign", { campaign_id: campaign.id, campaign_name: campaign.name, objective: campaign.objective } as RawInsight, undefined, ctx.currency),
        spend: 0, result: null, active: true, dailyBudget: minorToMajor(campaign.daily_budget), lifetimeBudget: minorToMajor(campaign.lifetime_budget),
      });
    }
  }
  return { rows, truncated: current.truncated || previous.truncated };
}

function accountError(error: unknown): string {
  const mapped = mapErrorKind(error);
  return mapped.metaMessage ? `${mapped.message} (${mapped.metaMessage})` : mapped.message;
}

/**
 * Campaigns / ad sets / ads of one client across the ad accounts the client enabled (principal
 * first, up to 5), or one account. A failing account is reported and the others still answer.
 */
export async function getClientCampaigns(args: { userId: string; level: CampaignLevel; periods: ComparedPeriods; adAccountId?: string; campaignId?: string }) {
  const token = await getUserAccessTokenByUserId(args.userId);
  if (!token.success) throw new Error(`Sem leitura da Meta deste cliente: ${token.error.message}`);
  const { accessToken, connection } = token;
  const profile = await getUserWithAdAccounts(accessToken, {
    tokenKind: connection.tokenKind, bisuAppScopedId: connection.bisuAppScopedId,
    clientBusinessId: connection.clientBusinessId, connectionName: connection.name,
  });
  const visible = profile.adaccounts?.data ?? [];
  let accounts: PlaybookAccount[];
  if (args.adAccountId) {
    const wanted = args.adAccountId.replace(/^act_/, "");
    const match = visible.find(a => (a.account_id || a.id.replace(/^act_/, "")) === wanted);
    if (!match) throw new Error("Esta conta de anúncios não está concedida ao cliente.");
    accounts = [{ accountId: `act_${wanted}`, name: match.name ?? null }];
  } else {
    accounts = pickPlaybookAccounts({ visible, enabledIds: await listEnabledAdAccountIds(args.userId) });
  }
  if (accounts.length === 0) return { accounts: [], rows: [] as ClientCampaignRow[], truncated: false };

  const currencyOf = (accountId: string) => visible.find(a => a.id === accountId || `act_${a.account_id}` === accountId)?.currency ?? "BRL";
  const results = await Promise.all(accounts.map(async account => {
    const ctx = { accessToken, accountId: account.accountId, currency: currencyOf(account.accountId) };
    try {
      return { account, currency: ctx.currency, ...(await readAccount({ ctx, level: args.level, periods: args.periods, campaignId: args.campaignId })), error: null };
    } catch (error) {
      return { account, currency: ctx.currency, rows: [] as ClientCampaignRow[], truncated: false, error: accountError(error) };
    }
  }));

  const multiple = accounts.length > 1;
  return {
    accounts: results.map(r => ({
      id: r.account.accountId, name: r.account.name, currency: r.currency,
      spend: round2(r.rows.reduce((sum, row) => sum + (row.spend ?? 0), 0)),
      ...(r.error ? { error: r.error } : {}),
    })),
    rows: results.flatMap(r => r.rows.map(row => (multiple ? { ...row, account: r.account.name ?? r.account.accountId } : row))),
    truncated: results.some(r => r.truncated),
  };
}
