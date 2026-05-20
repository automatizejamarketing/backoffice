import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

/**
 * Native Meta `/copies` duplication, orchestrated entity-by-entity.
 *
 * We deliberately DO NOT use `deep_copy=true` on campaign or ad set copies.
 * Meta enforces a hard sync-copy limit (errorSubcode 1885194: "the number of
 * ad objects to copy at once must be fewer than 3") that any campaign with
 * more than 2 ad sets, or any ad set with more than 2 ads, would hit. The
 * official async batch fallback returns the same error per the public Meta
 * developer-community thread, so the only universally-reliable path is to
 * copy one entity per call.
 *
 * For each copy Meta preserves 100% of the configuration (targeting, budget,
 * creative, promoted_object, schedule, ...). We rename the copied tree after
 * the fact to follow the SAME convention used when campaigns/ad sets/ads are
 * created (`<base>`, `<base> - Ad Set`, `<base> - Ad`).
 *
 * Constraints enforced here:
 * - Ad set copy is always created in the destination campaign.
 * - Ad copy is always created in the destination ad set.
 * - Status of the copies is inherited from the source (INHERITED_FROM_SOURCE).
 */

const COPY_MARKER = "Cópia";
const STATUS_OPTION = "INHERITED_FROM_SOURCE";
const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });

// Cap parallel ad copies inside a single ad set so we don't trigger Meta's
// rate limiter on large adsets (25+ ads). Chosen empirically: high enough to
// hide round-trip latency, low enough to stay under Meta's per-app throttle.
const AD_COPY_CONCURRENCY = 5;

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

/**
 * `<name> - Cópia`, or `<name> - Cópia 2`, `... 3` when a sibling already uses
 * the previous variant. Meta allows duplicate names; this just avoids confusion.
 */
function resolveCopyName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  const first = `${baseName} - ${COPY_MARKER}`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${baseName} - ${COPY_MARKER} ${n}`)) n += 1;
  return `${baseName} - ${COPY_MARKER} ${n}`;
}

/**
 * Mirrors the creation naming: a single child has no numeric suffix; multiple
 * children get ` 2`, ` 3`, ... (see `create-*-campaign.ts` and the backoffice
 * adsets POST route — `${base} - Ad${suffix}`).
 */
function childSuffix(count: number, index: number): string {
  return count > 1 ? ` ${index + 1}` : "";
}

function missingCopyIdError(kind: string): GraphApiError {
  return new GraphApiError({
    statusCode: 502,
    reason: {
      httpStatusCode: 502,
      title: "Falha na duplicação",
      message: `A Meta não retornou o ID ${kind} da cópia.`,
      solution: "Tente novamente em alguns instantes.",
      isTransient: true,
    },
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof GraphApiError) {
    return (
      err.errorReturn.reason.message ??
      err.errorReturn.reason.title ??
      "Erro desconhecido"
    );
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

type CopyResponse = {
  copied_campaign_id?: string;
  copied_adset_id?: string;
  copied_ad_id?: string;
};

type NamedNode = { id: string; name?: string };

type CampaignTree = {
  name?: string;
  adsets?: {
    data?: Array<{
      id: string;
      name?: string;
      ads?: { data?: NamedNode[] };
    }>;
  };
};

export type FailedCopy = {
  /** Source object id (the one we tried to copy). */
  sourceId: string;
  sourceName?: string;
  /** Source ad set id, only set for failed ad copies. */
  sourceAdsetId?: string;
  /** Why Meta rejected (or the call timed out). */
  error: string;
};

export type DuplicateResult = {
  id: string;
  name: string;
  sourceName: string;
  /** Adsets that failed to copy. Only present when at least one failed. */
  failedAdsets?: FailedCopy[];
  /** Ads that failed to copy. Only present when at least one failed. */
  failedAds?: FailedCopy[];
};

/**
 * Run `fn` over `items` with at most `concurrency` workers in flight. Each
 * task is independent — failures do NOT abort the others; instead the caller
 * inspects the per-item `Result`. Preserves input order in the output array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function renameObject(
  objectId: string,
  name: string,
  accessToken: string,
): Promise<void> {
  await metaApiCall<{ success?: boolean; id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: objectId,
    params: "",
    body: new URLSearchParams({ name }),
    accessToken,
  });
}

async function getCampaignTree(
  campaignId: string,
  accessToken: string,
): Promise<CampaignTree> {
  return metaApiCall<CampaignTree>({
    domain: "FACEBOOK",
    method: "GET",
    path: campaignId,
    params: "fields=name,adsets.limit(200){id,name,ads.limit(200){id,name}}",
    accessToken,
  });
}

async function listAdsetAds(
  adsetId: string,
  accessToken: string,
): Promise<NamedNode[]> {
  const res = await metaApiCall<{ data?: NamedNode[] }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${adsetId}/ads`,
    params: "fields=id,name&limit=200",
    accessToken,
  });
  return res.data ?? [];
}

/**
 * Copy a single ad set into a target campaign. No `deep_copy`: this only
 * creates the ad set itself; ads are copied separately by the caller.
 */
async function copyAdsetInto(
  sourceAdsetId: string,
  targetCampaignId: string,
  accessToken: string,
): Promise<string | undefined> {
  const res = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${sourceAdsetId}/copies`,
    params: "",
    body: new URLSearchParams({
      campaign_id: targetCampaignId,
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });
  return res.copied_adset_id;
}

/**
 * Copy a single ad into a target ad set. Meta duplicates the creative as part
 * of this call.
 */
async function copyAdInto(
  sourceAdId: string,
  targetAdsetId: string,
  accessToken: string,
): Promise<string | undefined> {
  const res = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${sourceAdId}/copies`,
    params: "",
    body: new URLSearchParams({
      adset_id: targetAdsetId,
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });
  return res.copied_ad_id;
}

type AdCopyOutcome =
  | { ok: true; sourceAd: NamedNode; copiedAdId: string }
  | { ok: false; sourceAd: NamedNode; error: string };

/**
 * Copy every ad in `sourceAds` into `targetAdsetId` with bounded concurrency.
 * Per-ad failures are captured (never thrown) so a single bad ad cannot abort
 * the rest of the duplication.
 */
async function copyAdsIntoAdset(
  sourceAds: NamedNode[],
  targetAdsetId: string,
  accessToken: string,
): Promise<AdCopyOutcome[]> {
  return mapWithConcurrency<NamedNode, AdCopyOutcome>(
    sourceAds,
    AD_COPY_CONCURRENCY,
    async (ad) => {
      try {
        const copiedAdId = await copyAdInto(ad.id, targetAdsetId, accessToken);
        if (!copiedAdId) {
          return {
            ok: false,
            sourceAd: ad,
            error: "A Meta não retornou o ID do anúncio copiado.",
          };
        }
        return { ok: true, sourceAd: ad, copiedAdId };
      } catch (err) {
        return { ok: false, sourceAd: ad, error: errorMessage(err) };
      }
    },
  );
}

/**
 * Duplicates a campaign (and its full tree: ad sets + ads) one entity at a
 * time, avoiding Meta's sync-copy size limit entirely. Renames the copied
 * tree to follow the creation convention. Per-entity failures are reported
 * back in `failedAdsets` / `failedAds` so the caller can warn the user.
 */
export async function duplicateCampaign(args: {
  accountId: string;
  campaignId: string;
  accessToken: string;
}): Promise<DuplicateResult> {
  const { accountId, campaignId, accessToken } = args;
  const act = formatAccountId(accountId);

  const sourceTree = await getCampaignTree(campaignId, accessToken);
  const sourceAdsets = sourceTree.adsets?.data ?? [];

  const siblings = await metaApiCall<{ data?: NamedNode[] }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${act}/campaigns`,
    params: "fields=name&limit=500",
    accessToken,
  });

  const newName = resolveCopyName(
    sourceTree.name ?? "Campanha",
    (siblings.data ?? []).map((c) => c.name ?? ""),
  );

  // 1) Copy the campaign by itself (no deep_copy → exactly 1 object).
  const campaignCopy = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${campaignId}/copies`,
    params: "",
    body: new URLSearchParams({
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });

  const newCampaignId = campaignCopy.copied_campaign_id;
  if (!newCampaignId) throw missingCopyIdError("da campanha");

  // 2) For each source ad set, copy it (1 object), then parallel-copy its
  //    ads into the freshly copied ad set. Track failures non-fatally.
  type AdsetCopyState = {
    sourceAdset: NamedNode;
    copiedAdsetId: string;
    adOutcomes: AdCopyOutcome[];
  };

  const adsetStates: AdsetCopyState[] = [];
  const failedAdsets: FailedCopy[] = [];

  for (const sa of sourceAdsets) {
    let copiedAdsetId: string | undefined;
    try {
      copiedAdsetId = await copyAdsetInto(sa.id, newCampaignId, accessToken);
    } catch (err) {
      failedAdsets.push({
        sourceId: sa.id,
        sourceName: sa.name,
        error: errorMessage(err),
      });
      continue;
    }
    if (!copiedAdsetId) {
      failedAdsets.push({
        sourceId: sa.id,
        sourceName: sa.name,
        error: "A Meta não retornou o ID do conjunto copiado.",
      });
      continue;
    }

    const sourceAds = sa.ads?.data ?? (await listAdsetAds(sa.id, accessToken));
    const adOutcomes = await copyAdsIntoAdset(
      sourceAds,
      copiedAdsetId,
      accessToken,
    );
    adsetStates.push({ sourceAdset: sa, copiedAdsetId, adOutcomes });
  }

  // 3) Rename the whole tree (campaign + adsets + ads) following the creation
  //    convention. Renames are sequential to keep error reporting simple.
  await renameObject(newCampaignId, newName, accessToken);

  const totalAds = adsetStates.reduce(
    (acc, s) => acc + s.adOutcomes.filter((o) => o.ok).length,
    0,
  );
  let adIndex = 0;
  for (let i = 0; i < adsetStates.length; i += 1) {
    const state = adsetStates[i];
    await renameObject(
      state.copiedAdsetId,
      `${newName} - Ad Set${childSuffix(adsetStates.length, i)}`,
      accessToken,
    );

    for (const outcome of state.adOutcomes) {
      if (!outcome.ok) continue;
      await renameObject(
        outcome.copiedAdId,
        `${newName} - Ad${childSuffix(totalAds, adIndex)}`,
        accessToken,
      );
      adIndex += 1;
    }
  }

  const failedAds = adsetStates.flatMap((state) =>
    state.adOutcomes
      .filter((o): o is Extract<AdCopyOutcome, { ok: false }> => !o.ok)
      .map(
        (o): FailedCopy => ({
          sourceId: o.sourceAd.id,
          sourceName: o.sourceAd.name,
          sourceAdsetId: state.sourceAdset.id,
          error: o.error,
        }),
      ),
  );

  return {
    id: newCampaignId,
    name: newName,
    sourceName: sourceTree.name ?? "Campanha",
    ...(failedAdsets.length > 0 && { failedAdsets }),
    ...(failedAds.length > 0 && { failedAds }),
  };
}

/**
 * Duplicates an ad set (with its ads) WITHIN THE SAME campaign, copying the
 * ad set itself and each ad individually so Meta's sync-copy limit is never
 * hit. The source `campaign_id` is read and passed explicitly so the copy
 * lands in the same campaign as the original.
 */
export async function duplicateAdSet(args: {
  accountId: string;
  adsetId: string;
  accessToken: string;
}): Promise<DuplicateResult> {
  const { adsetId, accessToken } = args;

  const source = await metaApiCall<{ name?: string; campaign_id?: string }>({
    domain: "FACEBOOK",
    method: "GET",
    path: adsetId,
    params: "fields=name,campaign_id",
    accessToken,
  });

  if (!source.campaign_id) throw missingCopyIdError("da campanha de origem");

  const [siblings, sourceAds] = await Promise.all([
    metaApiCall<{ data?: NamedNode[] }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${source.campaign_id}/adsets`,
      params: "fields=name&limit=500",
      accessToken,
    }),
    listAdsetAds(adsetId, accessToken),
  ]);

  const newName = resolveCopyName(
    source.name ?? "Conjunto",
    (siblings.data ?? []).map((a) => a.name ?? ""),
  );

  // 1) Copy the ad set itself (no deep_copy → exactly 1 object).
  const newAdsetId = await copyAdsetInto(
    adsetId,
    source.campaign_id,
    accessToken,
  );
  if (!newAdsetId) throw missingCopyIdError("do conjunto");

  // 2) Parallel-copy the ads into the new ad set, tracking failures.
  const adOutcomes = await copyAdsIntoAdset(
    sourceAds,
    newAdsetId,
    accessToken,
  );

  // 3) Rename ad set + each successfully copied ad.
  await renameObject(newAdsetId, newName, accessToken);

  const successfulAdCount = adOutcomes.filter((o) => o.ok).length;
  let adIndex = 0;
  for (const outcome of adOutcomes) {
    if (!outcome.ok) continue;
    await renameObject(
      outcome.copiedAdId,
      `${newName} - Ad${childSuffix(successfulAdCount, adIndex)}`,
      accessToken,
    );
    adIndex += 1;
  }

  const failedAds = adOutcomes
    .filter((o): o is Extract<AdCopyOutcome, { ok: false }> => !o.ok)
    .map(
      (o): FailedCopy => ({
        sourceId: o.sourceAd.id,
        sourceName: o.sourceAd.name,
        sourceAdsetId: adsetId,
        error: o.error,
      }),
    );

  return {
    id: newAdsetId,
    name: newName,
    sourceName: source.name ?? "Conjunto",
    ...(failedAds.length > 0 && { failedAds }),
  };
}

/**
 * Copies an ad WITHIN THE SAME ad set. Single-entity `/copies` already fits
 * Meta's sync limit comfortably, so this path is unchanged from before.
 */
export async function duplicateAd(args: {
  accountId: string;
  adId: string;
  accessToken: string;
}): Promise<DuplicateResult> {
  const { adId, accessToken } = args;

  const source = await metaApiCall<{ name?: string; adset_id?: string }>({
    domain: "FACEBOOK",
    method: "GET",
    path: adId,
    params: "fields=name,adset_id",
    accessToken,
  });

  if (!source.adset_id) throw missingCopyIdError("do conjunto de origem");

  const siblings = await metaApiCall<{ data?: NamedNode[] }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${source.adset_id}/ads`,
    params: "fields=name&limit=500",
    accessToken,
  });

  const newName = resolveCopyName(
    source.name ?? "Anúncio",
    (siblings.data ?? []).map((a) => a.name ?? ""),
  );

  const newAdId = await copyAdInto(adId, source.adset_id, accessToken);
  if (!newAdId) throw missingCopyIdError("do anúncio");

  await renameObject(newAdId, newName, accessToken);

  return {
    id: newAdId,
    name: newName,
    sourceName: source.name ?? "Anúncio",
  };
}
