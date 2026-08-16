/**
 * getInsights — the performance workhorse (design §4.3).
 *
 * Levels (account|campaign|adset|ad); scope by parent object (children in one
 * call), by explicit ids, or whole account; all date presets + custom range;
 * time series; breakdowns; validated extra metrics; objective-aware results;
 * currency conversion; internal pagination + truncation. Cursors and raw fields
 * never reach the model.
 *
 * Sorting: base numeric metrics use Meta's `sort=`; computed metrics
 * (result/roas/costPerResult/value) are sorted CLIENT-SIDE after normalization
 * (Graph cannot sort by an aggregated computed value — design §3, rule 13).
 */
import type { GraphPaging } from "@/lib/meta-business/types";
import {
  buildDateParts,
  buildFilteringPart,
  buildSortPart,
  callMeta,
  formatAccountId,
  resolveParentObjectId,
  type MetaCtx,
} from "./client";
import {
  BASE_METRIC_FIELDS,
  RESULT_FIELDS,
  validateExtraMetrics,
} from "./catalogs/metrics";
import { validateBreakdowns } from "./catalogs/breakdowns";
import {
  normalizeInsightRow,
  specsForFields,
  type NormalizedInsight,
} from "./normalize";
import { toNumber } from "./currency";
import {
  assertWithinSyncBudget,
  paginate,
  DEFAULT_MAX_ROWS,
} from "./pagination";
import { assertObjectInAccount } from "./envelope";

export type InsightsLevel = "account" | "campaign" | "adset" | "ad";

/** Meta-sortable base fields (sorted server-side). */
const META_SORTABLE = new Set([
  "spend",
  "impressions",
  "clicks",
  "cpc",
  "cpm",
  "ctr",
  "cpp",
  "reach",
  "frequency",
]);

/** Computed sort keys (sorted client-side over normalized rows). */
type ComputedSortKey = "result" | "roas" | "costPerResult" | "value";
const COMPUTED_SORT = new Set<ComputedSortKey>([
  "result",
  "roas",
  "costPerResult",
  "value",
]);

export type InsightRow = NormalizedInsight & {
  id?: string;
  name?: string;
  /**
   * Parent ids, when the row's level carries them (an ad row knows its ad set and campaign).
   * The scan walks ad → ad set → campaign to resolve the budget and the objective behind each ad.
   */
  campaignId?: string;
  adSetId?: string;
  level: InsightsLevel;
};

export type GetInsightsArgs = {
  level: InsightsLevel;
  /** Scope by parent object id (its children at `level` in one call). */
  parentId?: string;
  /** Scope by explicit object ids at `level`. */
  ids?: string[];
  datePreset?: string;
  since?: string;
  until?: string;
  /** Day-by-day (or week/month) series for trend reading. */
  timeIncrement?: "day" | "week" | "month";
  breakdowns?: string[];
  extraMetrics?: string[];
  sort?: { field: string; direction: "asc" | "desc" };
  /** Objective hint (from findObjects) so results extract correctly. */
  objective?: string | null;
  /**
   * Objective PER CAMPAIGN id. When set, each row's result is extracted with the objective of the
   * campaign THAT ROW belongs to — a single `objective` would read "Compras" on a leads ad in an
   * account that mixes objectives (ADR 0022, decision 9). Falls back to `objective`, then to the
   * generic result, for a campaign that isn't in the map.
   *
   * Only applies where the row carries a `campaign_id` (levels campaign/adset/ad).
   */
  objectiveByCampaignId?: Record<string, string>;
  /**
   * End the sweep at the first row whose spend falls below this (account-currency, MAJOR units),
   * dropping it and everything after it, and never fetching the next page.
   *
   * Requires `sort: { field: "spend", direction: "desc" }` and forbids `timeIncrement`/
   * `breakdowns` — under either of those a row is one time/breakdown SLICE of an object, so the
   * floor would be compared against a fraction of that object's spend. Both are refused (throw)
   * rather than silently dropping rows that still qualify. Used by the AI-creation account scan,
   * whose candidates all live in the high-spend head.
   */
  stopBelowSpend?: number;
  /**
   * Raise the internal pagination ceiling for a sweep that must be EXHAUSTIVE rather than a
   * top-N page: the AI-creation scan needs EVERY ad above the spend floor, because the mold is
   * ranked by ROAS, not by spend — the best-ROAS ad can sit deep in the spend ranking (ADR 0022 §9
   * promises an exact cut, not a sample). Every other caller keeps the default ceiling.
   */
  maxRows?: number;
  maxPages?: number;
  limit?: number;
};

export type GetInsightsResult = {
  rows: InsightRow[];
  truncated: boolean;
  currency: string;
  timezoneName: string;
  /** Non-fatal notes (rejected metrics/breakdowns, lossy combos). */
  warnings: string[];
};

const ID_NAME_FIELDS: Record<InsightsLevel, string[]> = {
  account: ["account_id", "account_name"],
  campaign: ["campaign_id", "campaign_name"],
  adset: ["adset_id", "adset_name", "campaign_id"],
  ad: ["ad_id", "ad_name", "adset_id", "campaign_id"],
};

function rowIdentity(
  raw: Record<string, unknown>,
  level: InsightsLevel,
): { id?: string; name?: string; campaignId?: string; adSetId?: string } {
  const idKey = `${level}_id`;
  const nameKey = `${level}_name`;
  return {
    ...(raw[idKey] != null ? { id: String(raw[idKey]) } : {}),
    ...(raw[nameKey] != null ? { name: String(raw[nameKey]) } : {}),
    // Parent ids — already on the row (ID_NAME_FIELDS asks for them); at campaign/account level
    // they'd only repeat `id`.
    ...(level !== "campaign" && level !== "account" && raw.campaign_id != null
      ? { campaignId: String(raw.campaign_id) }
      : {}),
    ...(level === "ad" && raw.adset_id != null
      ? { adSetId: String(raw.adset_id) }
      : {}),
  };
}

function estimatePeriods(args: GetInsightsArgs): number {
  if (!args.timeIncrement) return 1;
  // Coarse upper bound for the sync-budget guard.
  return args.timeIncrement === "day" ? 90 : args.timeIncrement === "week" ? 14 : 6;
}

function computedValue(row: InsightRow, key: ComputedSortKey): number {
  switch (key) {
    case "result":
      return row.result.count ?? -Infinity;
    case "roas":
      return row.result.roas ?? -Infinity;
    case "value":
      return row.result.value ?? -Infinity;
    case "costPerResult":
      return row.result.costPerResult ?? Infinity;
  }
}

/**
 * The objective to read a row's result with: the row's own campaign first (mixed-objective
 * sweeps), then the blanket hint, then the generic default (inside `resolveObjectiveResult`).
 */
function objectiveForRow(
  raw: Record<string, unknown>,
  args: GetInsightsArgs,
): string | null | undefined {
  if (args.objectiveByCampaignId && raw.campaign_id != null) {
    const found = args.objectiveByCampaignId[String(raw.campaign_id)];
    if (found) return found;
  }
  return args.objective;
}

export async function getInsights(
  ctx: MetaCtx,
  args: GetInsightsArgs,
): Promise<GetInsightsResult> {
  const warnings: string[] = [];

  // Programming errors, not user conditions: an early stop is only sound when a failing row PROVES
  // every later row fails too. Break either precondition and it silently drops qualifying rows —
  // exactly the "right-looking but wrong" answer this layer exists to prevent (design §8). Refuse
  // before any Graph call.
  if (args.stopBelowSpend != null) {
    if (!(args.sort?.field === "spend" && args.sort.direction === "desc")) {
      throw new Error(
        "getInsights: `stopBelowSpend` requires sort={field:'spend',direction:'desc'} — " +
          "on any other ordering it would drop rows that still qualify.",
      );
    }
    if (args.timeIncrement || args.breakdowns?.length) {
      throw new Error(
        "getInsights: `stopBelowSpend` cannot be combined with `timeIncrement` or `breakdowns` — " +
          "a row is then one time/breakdown slice, so a lifetime floor would be compared against " +
          "a fraction of the object's spend.",
      );
    }
  }

  // Validate extra metrics + breakdowns against the catalogs (before any call).
  const { valid: extraFields, rejected: rejectedMetrics } = validateExtraMetrics(
    args.extraMetrics,
  );
  if (rejectedMetrics.length) {
    warnings.push(
      `Métricas não disponíveis (ignoradas): ${rejectedMetrics.join(", ")}.`,
    );
  }

  const fieldList = [...BASE_METRIC_FIELDS, ...RESULT_FIELDS, ...extraFields];
  const bd = validateBreakdowns(args.breakdowns, fieldList);
  if (bd.rejected.length) {
    warnings.push(`Recortes inválidos (ignorados): ${bd.rejected.join(", ")}.`);
  }
  warnings.push(...bd.warnings);

  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);

  // Pre-flight size guard → OversizedError → agent renegotiates.
  assertWithinSyncBudget({
    objectCount: args.ids?.length ?? limit,
    periods: estimatePeriods(args),
    breakdownCount: bd.valid.length,
  });

  // Resolve path + scoping. Parent scope → children of one object; ids → filter
  // at account level; otherwise account-wide at `level`.
  //
  // A `parentId` naming the CONVERSATION ACCOUNT is not a parent object at all —
  // it's the account-wide read, and it must go through `act_{id}/insights` like
  // every other account-edge call. Sent as-is it produced the wasted 400 in Vercel
  // report A-06 ("Tried accessing nonexisting field (insights)"), which the model
  // only recovered from by asking again. `null` here = "no parent object".
  const parentId = resolveParentObjectId(args.parentId, ctx.adAccountId);
  const accountPath = formatAccountId(ctx.adAccountId);
  let path: string;
  const scopeParts: string[] = [];

  if (parentId) {
    path = `${parentId}/insights`;
    if (args.level !== "account") scopeParts.push(`level=${args.level}`);
  } else {
    path = `${accountPath}/insights`;
    if (args.level !== "account") scopeParts.push(`level=${args.level}`);
    if (args.ids?.length) {
      scopeParts.push(
        buildFilteringPart([
          { field: `${args.level}.id`, operator: "IN", value: args.ids },
        ]),
      );
    }
  }

  // `account_id` rides along so the parent-scoped path can verify ownership
  // (ADR 0013) with no extra call; deduped since the account level already lists it.
  const fields = Array.from(
    new Set([...fieldList, ...ID_NAME_FIELDS[args.level], "account_id"]),
  ).join(",");

  const dateParts =
    buildDateParts({
      datePreset: args.datePreset,
      since: args.since,
      until: args.until,
    });
  // Default window when none provided.
  if (dateParts.length === 0) dateParts.push("date_preset=last_30d");

  const useMetaSort =
    args.sort && META_SORTABLE.has(args.sort.field) ? args.sort : undefined;
  const computedSort =
    args.sort && COMPUTED_SORT.has(args.sort.field as ComputedSortKey)
      ? (args.sort.field as ComputedSortKey)
      : undefined;

  // Guaranteed spend-descending (and slice-free) by the guard above, so the first row under the
  // floor ends the sweep: everything after it is under the floor too.
  const spendFloor = args.stopBelowSpend;
  const takeWhileSorted =
    spendFloor != null
      ? (raw: Record<string, unknown>) => {
          const spend = toNumber(raw.spend as string | number | null | undefined);
          // An UNKNOWN spend must never end the sweep. Reading a row too many is free (the caller
          // filters by the floor anyway); ending the sweep on it would drop every qualifying row
          // behind it.
          return spend == null || spend >= spendFloor;
        }
      : undefined;

  const { rows: rawRows, truncated } = await paginate<Record<string, unknown>>(
    async (after) => {
      const parts = [`fields=${fields}`, ...dateParts, ...scopeParts, `limit=${limit}`];
      if (bd.valid.length) parts.push(`breakdowns=${bd.valid.join(",")}`);
      if (args.timeIncrement) parts.push(`time_increment=${args.timeIncrement}`);
      if (useMetaSort) parts.push(buildSortPart(useMetaSort.field, useMetaSort.direction));
      if (after) parts.push(`after=${after}`);
      const res = await callMeta<{
        data?: Array<Record<string, unknown>>;
        paging?: GraphPaging;
      }>({
        domain: "FACEBOOK",
        method: "GET",
        path,
        params: parts.join("&"),
        accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.cursors?.after };
    },
    {
      // Time series / breakdowns can produce many rows per object; allow the cap. An exhaustive
      // sweep (the AI-creation scan) raises it explicitly.
      maxRows: args.maxRows ?? DEFAULT_MAX_ROWS,
      ...(args.maxPages != null ? { maxPages: args.maxPages } : {}),
      ...(takeWhileSorted ? { takeWhileSorted } : {}),
    },
  );

  // Read-side ownership guard (ADR 0013): a parent-scoped query hits the parent's
  // GLOBAL id (`{parentId}/insights`), so confirm the returned rows belong to the
  // conversation account. The ids-scoped and account-level paths already query
  // act_{ctx}/insights, so they're inherently account-safe — including a
  // `parentId` that resolved to the account itself, which `resolveParentObjectId`
  // already folded into that path. No extra call — the owner rides on
  // `account_id`; an empty result leaks nothing.
  if (parentId) {
    const owner = rawRows.find((r) => r.account_id != null)?.account_id;
    assertObjectInAccount(
      parentId,
      owner as string | undefined,
      ctx.adAccountId,
    );
  }

  const extraSpecs = specsForFields(extraFields);
  let rows: InsightRow[] = rawRows.map((raw) => ({
    ...rowIdentity(raw, args.level),
    level: args.level,
    ...normalizeInsightRow(raw, {
      objective: objectiveForRow(raw, args),
      extraSpecs,
      breakdowns: bd.valid,
      currency: ctx.currency,
    }),
  }));

  // Client-side sort for computed metrics Graph can't sort by.
  if (computedSort) {
    const dir = args.sort?.direction === "asc" ? 1 : -1;
    rows = rows
      .slice()
      .sort((a, b) => (computedValue(a, computedSort) - computedValue(b, computedSort)) * dir);
  }

  return {
    rows,
    truncated,
    currency: ctx.currency,
    timezoneName: ctx.timezoneName,
    warnings,
  };
}
