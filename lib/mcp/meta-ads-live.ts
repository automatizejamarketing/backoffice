import "server-only";

import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { RESULT_FIELDS } from "@/lib/meta-business/insights/catalogs/metrics";
import { buildFilteringPart, callMeta } from "@/lib/meta-business/insights/client";
import { minorToMajor, round2 } from "@/lib/meta-business/insights/currency";
import { mapErrorKind } from "@/lib/meta-business/insights/envelope";
import { normalizeInsightRow, type RawInsight } from "@/lib/meta-business/insights/normalize";
import { paginate } from "@/lib/meta-business/insights/pagination";
import { cachedMetaRead, INSIGHTS_CACHE_TTL_MS, tokenCacheId } from "@/lib/meta-business/read-cache";
import { pctChange, pickClientAccounts, type ComparedPeriods, type Period } from "./meta-ads-metrics";

type ClientAccount = { accountId: string; name: string | null };

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
      if (campaignId) parts.push(buildFilteringPart([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]));
      if (after) parts.push(`after=${after}`);
      const res = await callMeta<{ data?: RawInsight[]; paging?: { cursors?: { after?: string }; next?: string } }>({
        domain: "FACEBOOK", method: "GET", path: `${ctx.accountId}/insights`, params: parts.join("&"), accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.next ? res.paging.cursors?.after : undefined };
    }, { maxRows: MAX_ROWS, maxPages: 2 }),
  });
}

type RawCampaign = { id: string; name?: string; objective?: string; daily_budget?: string; lifetime_budget?: string };

/**
 * Active campaigns with their budget — the ones running even if they spent nothing yet. Up to
 * 500; past that `truncated` says a campaign missing from the list may still be active.
 */
async function fetchActiveCampaigns(ctx: Ctx) {
  return cachedMetaRead({
    key: `mcp:active-campaigns:${tokenCacheId(ctx.accessToken)}:${ctx.accountId}`,
    ttlMs: 2 * 60 * 1000,
    fetcher: () => paginate<RawCampaign>(async after => {
      const res = await callMeta<{ data?: RawCampaign[]; paging?: { cursors?: { after?: string }; next?: string } }>({
        domain: "FACEBOOK", method: "GET", path: `${ctx.accountId}/campaigns`, accessToken: ctx.accessToken,
        params: `fields=id,name,objective,daily_budget,lifetime_budget&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}&limit=100${after ? `&after=${after}` : ""}`,
      });
      return { data: res.data ?? [], after: res.paging?.next ? res.paging.cursors?.after : undefined };
    }, { maxRows: 500, maxPages: 5 }),
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
  const p = summarize(prev, currency);
  const c0 = summarize(cur, currency);
  // It sold last period and spent this one without a sale: that is ROAS 0, not "no ROAS".
  const c = c0 && c0.result.roas == null && p?.result.roas != null && (c0.spend ?? 0) > 0
    ? { ...c0, result: { ...c0.result, roas: 0 } } : c0;
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

export type ClientCampaignRow = ReturnType<typeof rowFor> & { account?: string; currency?: string; active?: boolean; dailyBudget?: number | null; lifetimeBudget?: number | null };

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
    const activeById = new Map(active.rows.map(c => [c.id, c]));
    for (const row of rows) {
      const campaign = activeById.get(row.id);
      // Not in a truncated list = unknown, not inactive.
      if (campaign || !active.truncated) row.active = Boolean(campaign);
      if (campaign) Object.assign(row, { dailyBudget: minorToMajor(campaign.daily_budget), lifetimeBudget: minorToMajor(campaign.lifetime_budget) });
    }
    for (const campaign of active.rows) {
      if (seen.has(campaign.id) || (campaignId && campaign.id !== campaignId)) continue;
      rows.push({
        ...rowFor("campaign", { campaign_id: campaign.id, campaign_name: campaign.name, objective: campaign.objective } as RawInsight, undefined, ctx.currency),
        spend: 0, result: null, active: true, dailyBudget: minorToMajor(campaign.daily_budget), lifetimeBudget: minorToMajor(campaign.lifetime_budget),
      });
    }
  }
  return { rows, truncated: current.truncated || previous.truncated || Boolean(active?.truncated) };
}

function accountError(error: unknown): string {
  const mapped = mapErrorKind(error);
  return mapped.metaMessage ? `${mapped.message} (${mapped.metaMessage})` : mapped.message;
}

/**
 * Campaigns / ad sets / ads of one client across the ad accounts the connection sees, the ones
 * that spent most recently first (up to 5, `spendByAccount` from the daily warehouse), or one
 * account. A failing account is reported and the others still answer.
 */
export async function getClientCampaigns(args: { userId: string; level: CampaignLevel; periods: ComparedPeriods; spendByAccount: ReadonlyMap<string, number>; adAccountId?: string; campaignId?: string }) {
  const token = await getUserAccessTokenByUserId(args.userId);
  if (!token.success) throw new Error(`Sem leitura da Meta deste cliente: ${token.error.message}`);
  const { accessToken, connection } = token;
  const profile = await getUserWithAdAccounts(accessToken, {
    tokenKind: connection.tokenKind, bisuAppScopedId: connection.bisuAppScopedId,
    clientBusinessId: connection.clientBusinessId, connectionName: connection.name,
  });
  const visible = profile.adaccounts?.data ?? [];
  let accounts: ClientAccount[];
  let omitted: ClientAccount[] = [];
  if (args.adAccountId) {
    const wanted = args.adAccountId.replace(/^act_/, "");
    const match = visible.find(a => (a.account_id || a.id.replace(/^act_/, "")) === wanted);
    if (!match) throw new Error("Esta conta de anúncios não está concedida ao cliente.");
    accounts = [{ accountId: `act_${wanted}`, name: match.name ?? null }];
  } else {
    ({ accounts, omitted } = pickClientAccounts(visible, args.spendByAccount));
  }
  if (accounts.length === 0) return { accounts: [], omittedAccounts: [], rows: [] as ClientCampaignRow[], truncated: false };

  const currencyOf = (accountId: string) => visible.find(a => a.id === accountId || `act_${a.account_id}` === accountId)?.currency ?? "BRL";
  const readOne = async (account: ClientAccount) => {
    const ctx = { accessToken, accountId: account.accountId, currency: currencyOf(account.accountId) };
    try {
      return { account, currency: ctx.currency, ...(await readAccount({ ctx, level: args.level, periods: args.periods, campaignId: args.campaignId })), error: null };
    } catch (error) {
      return { account, currency: ctx.currency, rows: [] as ClientCampaignRow[], truncated: false, error: accountError(error) };
    }
  };
  // Two accounts at a time: 3 reads each on the same token stays clear of Meta's per-user limit (code 17).
  const results: Awaited<ReturnType<typeof readOne>>[] = [];
  for (let i = 0; i < accounts.length; i += 2) results.push(...(await Promise.all(accounts.slice(i, i + 2).map(readOne))));

  const multiple = accounts.length > 1;
  return {
    accounts: results.map(r => ({
      id: r.account.accountId, name: r.account.name, currency: r.currency,
      spend: round2(r.rows.reduce((sum, row) => sum + (row.spend ?? 0), 0)),
      ...(r.error ? { error: r.error } : {}),
    })),
    omittedAccounts: omitted,
    rows: results.flatMap(r => r.rows.map(row => ({
      ...row,
      ...(multiple ? { account: r.account.name ?? r.account.accountId } : {}),
      // Rows of several accounts are sorted together; money in another currency must say so.
      ...(r.currency !== "BRL" ? { currency: r.currency } : {}),
    }))),
    truncated: results.some(r => r.truncated),
  };
}
