/**
 * Proven ads scoped to the elected mold campaign (ADR 0023).
 *
 * Sales: only VALIDATED ads (ROAS >= 5). Other objectives: only BEST PROVEN ads (cheapest result
 * above the spend floor). Non-proven ads in the same campaign are excluded from duplication.
 */
import {
  getInsights,
  minorToMajor,
  callMeta,
  type MetaCtx,
} from "@/lib/meta-business/insights";
import {
  classifyAd,
  hasRoas,
  spendFloorFor,
  type AdCandidate,
  type AdClassification,
} from "./validation-rules";
import { validationWindow } from "./scan-account";
import type { MoldRef } from "./pick-mold";

export type ProvenAdRef = {
  adId: string;
  adName: string | null;
  adSetId: string;
  kind: Exclude<AdClassification, "none">;
  spend: number;
  roas: number | null;
  costPerResult: number | null;
  resultLabel: string;
  /** Creative thumb — `thumbnail_url` preferred, `image_url` fallback (Graph v25). */
  thumbnailUrl: string | null;
  /**
   * Whether THIS ad's ad set is Dynamic Creative. Carried so the caller can gate new media on the
   * REAL winning ad set (the top kept proven ad's set), not the elected ad's set — they differ once
   * the user deselects the top-ROAS ad (ADR 0023 ticket 06).
   */
  isDynamicCreative: boolean;
};

function isReusableProven(
  kind: AdClassification,
  objective: string | null,
): kind is Exclude<AdClassification, "none"> {
  if (kind === "none") return false;
  if (hasRoas(objective)) return kind === "validated";
  return kind === "best_proven";
}

function sortProvenAds(a: ProvenAdRef, b: ProvenAdRef, objective: string | null): number {
  if (hasRoas(objective)) {
    return (b.roas ?? 0) - (a.roas ?? 0) || b.spend - a.spend;
  }
  return (
    (a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity) || b.spend - a.spend
  );
}

/** Per-ad-set facts the picker reads in bulk (one `?ids=` per 50, Graph v25). */
type AdSetFacts = {
  /** Effective daily budget for floor selection — campaign under CBO, ad set under ABO. */
  dailyBudgetMajor: number | null;
  /** Whether the set is Dynamic Creative — new media cannot be added to such a set. */
  isDynamicCreative: boolean;
};

/**
 * The candidates' ad sets, in bulk: the daily budget that decides their spend floor AND whether
 * each is Dynamic Creative. Reading `is_dynamic_creative` here (instead of a separate call) keeps
 * the winning-ad-set DC check free of an extra read (ADR 0023 ticket 06).
 */
async function readAdSetFacts(
  ctx: MetaCtx,
  adSetIds: string[],
): Promise<Map<string, AdSetFacts>> {
  const byId = new Map<string, AdSetFacts>();
  if (adSetIds.length === 0) return byId;

  const chunkSize = 50;
  for (let i = 0; i < adSetIds.length; i += chunkSize) {
    const chunk = adSetIds.slice(i, i + chunkSize);
    const res = await callMeta<
      Record<string, { daily_budget?: string; is_dynamic_creative?: boolean }>
    >({
      domain: "FACEBOOK",
      method: "GET",
      path: "",
      params: `ids=${chunk.join(",")}&fields=daily_budget,is_dynamic_creative`,
      accessToken: ctx.accessToken,
    });
    for (const [id, node] of Object.entries(res ?? {})) {
      byId.set(id, {
        dailyBudgetMajor: minorToMajor(node?.daily_budget),
        isDynamicCreative: Boolean(node?.is_dynamic_creative),
      });
    }
  }
  return byId;
}

/** Batch-read creative thumbs for proven ads — one `?ids=` per 50 (Graph v25). */
async function readAdCreativeThumbnails(
  ctx: MetaCtx,
  adIds: string[],
): Promise<Map<string, string | null>> {
  const byId = new Map<string, string | null>();
  if (adIds.length === 0) return byId;

  const chunkSize = 50;
  for (let i = 0; i < adIds.length; i += chunkSize) {
    const chunk = adIds.slice(i, i + chunkSize);
    const res = await callMeta<
      Record<string, { creative?: { thumbnail_url?: string; image_url?: string } }>
    >({
      domain: "FACEBOOK",
      method: "GET",
      path: "",
      params: `ids=${chunk.join(",")}&fields=creative{thumbnail_url,image_url}`,
      accessToken: ctx.accessToken,
    });
    for (const [id, node] of Object.entries(res ?? {})) {
      const creative = node?.creative;
      byId.set(id, creative?.thumbnail_url ?? creative?.image_url ?? null);
    }
  }
  return byId;
}

/**
 * Every proven ad in the elected campaign, best-first. Used by the duplication plan/create path
 * (issue 01: all of them; issue 02: the user picks a subset via `keepAdIds`).
 */
export async function listProvenAdsInCampaign(
  ctx: MetaCtx,
  mold: MoldRef,
  campaignDailyBudgetMajor: number | null,
): Promise<ProvenAdRef[]> {
  const { since, until } = validationWindow(ctx.timezoneName);
  // Escopado à campanha do molde (`{campaignId}/insights`): a pergunta é sobre
  // UMA campanha, então varrer a conta inteira em nível de anúncio por 12 meses
  // era pagar o sweep do scan de novo — e, pior, o teto de 500 linhas da conta
  // podia cortar fora os anúncios de uma campanha funda no ranking de spend.
  const { rows } = await getInsights(ctx, {
    level: "ad",
    parentId: mold.campaignId,
    since,
    until,
    objective: mold.objective ?? undefined,
    limit: 100,
    maxRows: 1000,
  });

  const inCampaign = rows.filter((row) => row.campaignId === mold.campaignId && row.id);
  const adSetIds = Array.from(
    new Set(inCampaign.map((row) => row.adSetId).filter((id): id is string => Boolean(id))),
  );
  const adSetFacts = await readAdSetFacts(ctx, adSetIds);

  const proven: ProvenAdRef[] = [];
  for (const row of inCampaign) {
    if (!row.id || !row.adSetId || row.spend == null) continue;

    const facts = adSetFacts.get(row.adSetId);
    const dailyBudget =
      campaignDailyBudgetMajor ??
      facts?.dailyBudgetMajor ??
      null;

    const candidate: AdCandidate = {
      adId: row.id,
      adName: row.name ?? null,
      adSetId: row.adSetId,
      campaignId: mold.campaignId,
      objective: mold.objective,
      spend: row.spend,
      dailyBudget,
      roas: row.result.roas,
      result: {
        label: row.result.label,
        count: row.result.count,
        costPerResult: row.result.costPerResult,
      },
    };

    if (candidate.spend < spendFloorFor(candidate.dailyBudget)) continue;

    const kind = classifyAd(candidate);
    if (!isReusableProven(kind, mold.objective)) continue;

    proven.push({
      adId: row.id,
      adName: row.name ?? null,
      adSetId: row.adSetId,
      kind,
      spend: row.spend,
      roas: row.result.roas,
      costPerResult: row.result.costPerResult,
      resultLabel: row.result.label,
      thumbnailUrl: null,
      isDynamicCreative: facts?.isDynamicCreative ?? false,
    });
  }

  proven.sort((a, b) => sortProvenAds(a, b, mold.objective));

  const thumbs = await readAdCreativeThumbnails(
    ctx,
    proven.map((ad) => ad.adId),
  );
  for (const ad of proven) {
    ad.thumbnailUrl = thumbs.get(ad.adId) ?? null;
  }

  return proven;
}

export function provenAdIds(ads: ProvenAdRef[]): string[] {
  return ads.map((ad) => ad.adId);
}
