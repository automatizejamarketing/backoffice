/**
 * findObjects (name → id resolution) and getHierarchy (structure-only tree).
 *
 * findObjects ALWAYS returns a list and never resolves "the first" — the agent
 * disambiguates (design §4.2, system-prompt rules 1–2). Status defaults to
 * ACTIVE+PAUSED with an automatic fallback to archived on a zero match (design
 * grilling Q9). getHierarchy returns names/status/ids only and is discouraged for
 * ranking (use getInsights scoped to a parent instead).
 */
import type { GraphPaging } from "@/lib/meta-business/types";
import {
  buildFilteringPart,
  buildObjectFilters,
  callMeta,
  formatAccountId,
  resolveParentObjectId,
  type MetaCtx,
  type StatusScope,
} from "./client";
import { paginate, DEFAULT_MAX_ROWS } from "./pagination";
import { normalizeInsightRow, type NormalizedInsight } from "./normalize";

export type ObjectLevel = "campaign" | "adset" | "ad";

const EDGE: Record<ObjectLevel, string> = {
  campaign: "campaigns",
  adset: "adsets",
  ad: "ads",
};

/** Compact insight fields for withMetrics expansion (1-call named-object metric). */
const COMPACT_INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "cpc",
  "cpm",
  "ctr",
  "reach",
  "frequency",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "website_purchase_roas",
  "date_start",
  "date_stop",
].join(",");

function baseFields(level: ObjectLevel): string[] {
  switch (level) {
    case "campaign":
      return ["id", "name", "effective_status", "objective"];
    case "adset":
      return ["id", "name", "effective_status", "campaign_id", "campaign{objective}"];
    case "ad":
      return [
        "id",
        "name",
        "effective_status",
        "adset_id",
        "campaign_id",
        "campaign{objective}",
      ];
  }
}

/** Build the nested `insights(...)` expansion used by withMetrics. */
function insightsExpansion(args: {
  datePreset?: string;
  since?: string;
  until?: string;
}): string {
  if (args.since && args.until) {
    const range = JSON.stringify({ since: args.since, until: args.until });
    return `insights.time_range(${range}){${COMPACT_INSIGHT_FIELDS}}`;
  }
  const preset = args.datePreset ?? "last_30d";
  return `insights.date_preset(${preset}){${COMPACT_INSIGHT_FIELDS}}`;
}

type RawObject = {
  id: string;
  name?: string;
  effective_status?: string;
  objective?: string;
  campaign_id?: string;
  adset_id?: string;
  campaign?: { objective?: string };
  insights?: { data?: Array<Record<string, unknown>> };
};

export type FoundObject = {
  id: string;
  name: string;
  status: string;
  level: ObjectLevel;
  objective: string | null;
  campaignId?: string;
  adsetId?: string;
  metrics?: NormalizedInsight;
};

export type FindObjectsResult = {
  objects: FoundObject[];
  /** Which status scope produced the result (e.g. fell back to archived). */
  statusScopeUsed: StatusScope;
  truncated: boolean;
};

export type FindObjectsArgs = {
  level: ObjectLevel;
  nameContains?: string;
  status?: StatusScope;
  withMetrics?: boolean;
  datePreset?: string;
  since?: string;
  until?: string;
  /** Optional parent scoping (adset→campaign id, ad→adset id). */
  parentId?: string;
  limit?: number;
};

function parentField(level: ObjectLevel): string | undefined {
  if (level === "adset") return "campaign.id";
  if (level === "ad") return "adset.id";
  return undefined;
}

function mapObject(raw: RawObject, level: ObjectLevel, currency: string): FoundObject {
  const objective = raw.objective ?? raw.campaign?.objective ?? null;
  const insightRow = raw.insights?.data?.[0];
  return {
    id: raw.id,
    name: raw.name ?? "(sem nome)",
    status: raw.effective_status ?? "UNKNOWN",
    level,
    objective,
    ...(raw.campaign_id ? { campaignId: raw.campaign_id } : {}),
    ...(raw.adset_id ? { adsetId: raw.adset_id } : {}),
    ...(insightRow
      ? { metrics: normalizeInsightRow(insightRow, { objective, currency }) }
      : {}),
  };
}

async function runFind(
  ctx: MetaCtx,
  args: FindObjectsArgs,
  status: StatusScope,
): Promise<{ objects: FoundObject[]; truncated: boolean }> {
  const fields = [...baseFields(args.level)];
  if (args.withMetrics) {
    fields.push(
      insightsExpansion({
        datePreset: args.datePreset,
        since: args.since,
        until: args.until,
      }),
    );
  }

  // Same "the parent handed in IS the account" case as getInsights (A-06). Here it
  // wouldn't 400 — it would compile to `campaign.id EQUAL {account}` and quietly
  // return NOTHING, which the agent would report as "essa conta não tem conjuntos".
  // The account is already the query's scope (the path below), so drop the filter.
  const parentId =
    resolveParentObjectId(args.parentId, ctx.adAccountId) ?? undefined;

  const filters = buildObjectFilters({
    nameContains: args.nameContains,
    status,
    parentField: parentField(args.level),
    parentId,
  });

  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const path = `${formatAccountId(ctx.adAccountId)}/${EDGE[args.level]}`;

  const { rows, truncated } = await paginate<RawObject>(
    async (after) => {
      const parts = [
        `fields=${fields.join(",")}`,
        buildFilteringPart(filters),
        `limit=${limit}`,
      ];
      if (after) parts.push(`after=${after}`);
      const res = await callMeta<{ data?: RawObject[]; paging?: GraphPaging }>({
        domain: "FACEBOOK",
        method: "GET",
        path,
        params: parts.join("&"),
        accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.cursors?.after };
    },
    { maxRows: Math.min(limit * 2, DEFAULT_MAX_ROWS) },
  );

  return {
    objects: rows.map((r) => mapObject(r, args.level, ctx.currency)),
    truncated,
  };
}

/** Resolve objects by partial name + status; never picks "the first" itself. */
export async function findObjects(
  ctx: MetaCtx,
  args: FindObjectsArgs,
): Promise<FindObjectsResult> {
  // ACTIVE_PAUSED now includes the cascade-paused statuses (see STATUS_VALUES),
  // so children of a paused campaign/ad set are listed regardless of the scope
  // chosen — no parent-specific special-casing needed (BUG-005).
  const requested: StatusScope = args.status ?? "ACTIVE_PAUSED";
  const first = await runFind(ctx, args, requested);

  // Auto-fallback to archived on a zero match for a named query (design Q9).
  if (
    first.objects.length === 0 &&
    args.nameContains &&
    requested === "ACTIVE_PAUSED"
  ) {
    const withArchived = await runFind(ctx, args, "WITH_ARCHIVED");
    if (withArchived.objects.length > 0) {
      return {
        objects: withArchived.objects,
        statusScopeUsed: "WITH_ARCHIVED",
        truncated: withArchived.truncated,
      };
    }
  }

  return {
    objects: first.objects,
    statusScopeUsed: requested,
    truncated: first.truncated,
  };
}

// ---- getHierarchy ----------------------------------------------------------

export type HierarchyNode = {
  id: string;
  name: string;
  status: string;
  level: ObjectLevel;
  children?: HierarchyNode[];
};

export type GetHierarchyArgs = {
  /** Root campaign; when omitted, returns all account campaigns. */
  campaignId?: string;
  /** 1 = campaigns, 2 = +adsets, 3 = +ads. */
  depth?: 1 | 2 | 3;
};

type RawHierCampaign = {
  id: string;
  name?: string;
  effective_status?: string;
  adsets?: { data?: RawHierAdset[] };
};
type RawHierAdset = {
  id: string;
  name?: string;
  effective_status?: string;
  ads?: { data?: RawHierAd[] };
};
type RawHierAd = { id: string; name?: string; effective_status?: string };

function hierarchyFields(depth: number): string {
  const adFields = "ads.limit(50){id,name,effective_status}";
  const adsetFields =
    depth >= 3
      ? `adsets.limit(50){id,name,effective_status,${adFields}}`
      : "adsets.limit(50){id,name,effective_status}";
  return depth >= 2
    ? `id,name,effective_status,${adsetFields}`
    : "id,name,effective_status";
}

export async function getHierarchy(
  ctx: MetaCtx,
  args: GetHierarchyArgs,
): Promise<{ tree: HierarchyNode[]; truncated: boolean }> {
  const depth = args.depth ?? 2;
  const fields = hierarchyFields(depth);

  const buildCampaignNode = (c: RawHierCampaign): HierarchyNode => ({
    id: c.id,
    name: c.name ?? "(sem nome)",
    status: c.effective_status ?? "UNKNOWN",
    level: "campaign",
    ...(depth >= 2
      ? {
          children: (c.adsets?.data ?? []).map((s) => ({
            id: s.id,
            name: s.name ?? "(sem nome)",
            status: s.effective_status ?? "UNKNOWN",
            level: "adset" as const,
            ...(depth >= 3
              ? {
                  children: (s.ads?.data ?? []).map((a) => ({
                    id: a.id,
                    name: a.name ?? "(sem nome)",
                    status: a.effective_status ?? "UNKNOWN",
                    level: "ad" as const,
                  })),
                }
              : {}),
          })),
        }
      : {}),
  });

  // Same trap as getInsights (Vercel report A-06): a caller may hand the AD ACCOUNT
  // where a root CAMPAIGN is expected. The account's children are campaigns, not ad
  // sets, and its node only answers on `act_{id}` — so reading it as a campaign
  // would 400 on the `adsets` field. Resolving to null falls through to the
  // account-wide listing below, which is what "the account's hierarchy" means.
  const rootCampaignId = resolveParentObjectId(args.campaignId, ctx.adAccountId);

  if (rootCampaignId) {
    const raw = await callMeta<RawHierCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: rootCampaignId,
      params: `fields=${fields}`,
      accessToken: ctx.accessToken,
    });
    return { tree: [buildCampaignNode(raw)], truncated: false };
  }

  const { rows, truncated } = await paginate<RawHierCampaign>(
    async (after) => {
      const parts = [`fields=${fields}`, "limit=50"];
      if (after) parts.push(`after=${after}`);
      const res = await callMeta<{ data?: RawHierCampaign[]; paging?: GraphPaging }>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${formatAccountId(ctx.adAccountId)}/campaigns`,
        params: parts.join("&"),
        accessToken: ctx.accessToken,
      });
      return { data: res.data ?? [], after: res.paging?.cursors?.after };
    },
    { maxRows: 100 },
  );

  return { tree: rows.map(buildCampaignNode), truncated };
}
