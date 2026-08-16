/**
 * Scan an ad account for a [[Campanha molde]] (ADR 0022).
 *
 * THE COST (the Meta app's error/rate-limit budget is a shared resource — see the duplication ADR):
 * three READS, no writes. "Read" is the unit, not "HTTP call" — a paginated read is one page per
 * 100 objects and a bulk read is one call per 50 ids, so a typical account is literally 3 calls and
 * a huge one is a handful more:
 *   1. campaigns  — paginated: the objective, the CBO budget, and the ASC/AAC flag of each campaign;
 *   2. ad insights — paginated, sorted by spend DESCENDING, stopping at the lowest floor: every ad
 *      that could possibly qualify lives in the high-spend head, so the cut is exact, not a sample;
 *   3. ad sets    — a bulk `?ids=` read of the candidates' ad sets, chunked at Meta's 50-id cap
 *      (their daily budget decides which floor applies).
 *
 * The account context (currency/timezone) is the CALLER's — the route resolves it once, the way the
 * chat does, so it is not charged here.
 */
import type { GraphPaging } from "@/lib/meta-business/types";
import {
  buildFilteringPart,
  buildObjectFilters,
  callMeta,
  formatAccountId,
  getInsights,
  minorToMajor,
  paginate,
  type InsightRow,
  type MetaCtx,
} from "@/lib/meta-business/insights";
import { pickMold, type MoldRef } from "./pick-mold";
import {
  SPEND_FLOOR_LOW_BUDGET,
  VALIDATION_WINDOW_MONTHS,
  type AdCandidate,
} from "./validation-rules";

export type ScanResult = {
  /** The elected mold, or null — an account with no proof scans clean and says nothing. */
  mold: MoldRef | null;
  /**
   * A read hit its ceiling, so the account was NOT swept whole: either the spend-sorted ad sweep or
   * the campaign listing was cut short. The elected mold is then the best of what we saw, not
   * necessarily the best there is — the UI must say so rather than swallow it.
   */
  truncated: boolean;
  currency: string;
};

const CAMPAIGN_FIELDS =
  "id,name,objective,daily_budget,lifetime_budget,smart_promotion_type";
const AD_SET_FIELDS = "id,daily_budget,lifetime_budget";

const PAGE_SIZE = 100;
/** Meta caps a bulk `?ids=` read at 50 objects. */
const BULK_CHUNK = 50;
/**
 * The sweep must be EXHAUSTIVE, not a top-N page: the mold is ranked by ROAS but read in spend
 * order, so the best-ROAS ad can sit deep in the spend ranking. The reader's default ceiling (250)
 * was sized for the chat, not for this.
 */
const SWEEP_MAX_ROWS = 1000;
const SWEEP_MAX_PAGES = 20;

type RawCampaign = {
  id: string;
  name?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  /** Present on Advantage+ Shopping / App campaigns — Meta will not let us copy those. */
  smart_promotion_type?: string;
};

type RawAdSet = {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

/**
 * The 12-month window, as Graph's `time_range` wants it (YYYY-MM-DD).
 *
 * Dated in the ACCOUNT's timezone, not the server's: Meta resolves `time_range` in the ad account's
 * timezone, so a UTC "today" would shift the window by a day for a São Paulo account (design §4.1).
 */
export function validationWindow(timeZone: string): { since: string; until: string } {
  // en-CA gives ISO-shaped YYYY-MM-DD, which is exactly what `time_range` wants.
  const inAccountTz = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - VALIDATION_WINDOW_MONTHS);

  return { since: inAccountTz(start), until: inAccountTz(now) };
}

/** Every campaign in the account — archived ones included: an old mold is still a mold. */
async function readCampaigns(
  ctx: MetaCtx,
): Promise<{ campaigns: Map<string, RawCampaign>; truncated: boolean }> {
  const path = `${formatAccountId(ctx.adAccountId)}/campaigns`;
  const filtering = buildFilteringPart(
    buildObjectFilters({ status: "WITH_ARCHIVED" }),
  );

  const { rows, truncated } = await paginate<RawCampaign>(
    async (after) => {
      const parts = [
        `fields=${CAMPAIGN_FIELDS}`,
        filtering,
        `limit=${PAGE_SIZE}`,
        ...(after ? [`after=${after}`] : []),
      ];
      const res = await callMeta<{ data?: RawCampaign[]; paging?: GraphPaging }>({
        domain: "FACEBOOK",
        method: "GET",
        path,
        params: parts.join("&"),
        accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.cursors?.after };
    },
    { maxRows: SWEEP_MAX_ROWS, maxPages: SWEEP_MAX_PAGES },
  );

  // A cut-short campaign listing is NOT harmless: an ad whose campaign fell off the map is dropped
  // as unusable below, so the mold could quietly come from an incomplete account.
  return {
    campaigns: new Map(rows.map((campaign) => [campaign.id, campaign])),
    truncated,
  };
}

/** The candidates' ad sets, in bulk — we only want the budget that decides their floor. */
async function readAdSets(
  ctx: MetaCtx,
  adSetIds: string[],
): Promise<Map<string, RawAdSet>> {
  const byId = new Map<string, RawAdSet>();

  for (let i = 0; i < adSetIds.length; i += BULK_CHUNK) {
    const chunk = adSetIds.slice(i, i + BULK_CHUNK);
    const res = await callMeta<Record<string, RawAdSet>>({
      domain: "FACEBOOK",
      method: "GET",
      path: "",
      params: `ids=${chunk.join(",")}&fields=${AD_SET_FIELDS}`,
      accessToken: ctx.accessToken,
    });
    for (const [id, node] of Object.entries(res ?? {})) {
      if (node) byId.set(id, node);
    }
  }

  return byId;
}

/**
 * The ad's effective daily budget: the campaign's under CBO, the ad set's under ABO. A lifetime
 * budget yields no daily number — that reads as UNKNOWN (and takes the conservative floor).
 */
function effectiveDailyBudget(
  campaign: RawCampaign | undefined,
  adSet: RawAdSet | undefined,
): number | null {
  return (
    minorToMajor(campaign?.daily_budget) ?? minorToMajor(adSet?.daily_budget)
  );
}

function toCandidate(
  row: InsightRow,
  campaigns: Map<string, RawCampaign>,
  adSets: Map<string, RawAdSet>,
): AdCandidate | null {
  if (!row.id || !row.adSetId || !row.campaignId || row.spend == null) return null;

  const campaign = campaigns.get(row.campaignId);
  return {
    adId: row.id,
    adName: row.name ?? null,
    adSetId: row.adSetId,
    campaignId: row.campaignId,
    objective: campaign?.objective ?? null,
    spend: row.spend,
    dailyBudget: effectiveDailyBudget(campaign, adSets.get(row.adSetId)),
    roas: row.result.roas,
    result: {
      label: row.result.label,
      count: row.result.count,
      costPerResult: row.result.costPerResult,
    },
  };
}

/**
 * The objectives that count as "selling" — ODAX plus the two legacy names Meta still returns on old
 * campaigns. A campaign whose objective we never read (`null`) is NOT one of them: it cannot be
 * confirmed as a sales campaign, and a mold is only worth copying when we know what it optimised for.
 */
export const SALES_CAMPAIGN_OBJECTIVES = [
  "OUTCOME_SALES",
  "CONVERSIONS",
  "PRODUCT_CATALOG_SALES",
] as const;

export type ScanAccountOptions = {
  /**
   * Restrict the mold to campaigns with one of these objectives.
   *
   * The AI flow asks the user what they want BEFORE scanning, and the elected mold has to be able to
   * deliver it: without this the election picks the account's dominant objective by spend, so a user
   * who asked for a sales campaign could have a traffic campaign duplicated instead.
   */
  objectives?: readonly string[];
};

export async function scanAccountForMold(
  ctx: MetaCtx,
  options: ScanAccountOptions = {},
): Promise<ScanResult> {
  const { campaigns, truncated: campaignsTruncated } = await readCampaigns(ctx);

  // The objective of each row's OWN campaign — a single objective would read "Compras" on a leads
  // ad in an account that mixes objectives.
  const objectiveByCampaignId: Record<string, string> = {};
  for (const [id, campaign] of campaigns) {
    if (campaign.objective) objectiveByCampaignId[id] = campaign.objective;
  }

  const { since, until } = validationWindow(ctx.timezoneName);
  const { rows, truncated: sweepTruncated } = await getInsights(ctx, {
    level: "ad",
    since,
    until,
    sort: { field: "spend", direction: "desc" },
    // Nothing under the LOWEST floor can qualify under any budget, so the sweep ends there.
    stopBelowSpend: SPEND_FLOOR_LOW_BUDGET,
    objectiveByCampaignId,
    limit: PAGE_SIZE,
    maxRows: SWEEP_MAX_ROWS,
    maxPages: SWEEP_MAX_PAGES,
  });

  // An ASC/AAC campaign cannot be copied (Meta refuses), so its ads are not candidates. Nor is an
  // ad whose campaign we never saw.
  const truncated = sweepTruncated || campaignsTruncated;

  const usable = rows.filter((row) => {
    const campaign = row.campaignId ? campaigns.get(row.campaignId) : undefined;
    return campaign != null && !campaign.smart_promotion_type;
  });

  if (usable.length === 0) {
    return { mold: null, truncated, currency: ctx.currency };
  }

  const adSetIds = Array.from(
    new Set(usable.map((row) => row.adSetId).filter((id): id is string => Boolean(id))),
  );
  const adSets = await readAdSets(ctx, adSetIds);

  const allowedObjectives = options.objectives;
  const candidates = usable
    .map((row) => toCandidate(row, campaigns, adSets))
    .filter((candidate): candidate is AdCandidate => candidate != null)
    .filter(
      (candidate) =>
        !allowedObjectives ||
        (candidate.objective != null &&
          allowedObjectives.includes(candidate.objective)),
    );

  return {
    mold: pickMold(candidates, ctx.currency),
    truncated,
    currency: ctx.currency,
  };
}
