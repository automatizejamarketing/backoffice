import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

/**
 * Native Meta `/copies` duplication.
 *
 * Meta copies the object server-side preserving 100% of the configuration
 * (targeting, budget, creative, promoted_object, schedule, ...). We copy with
 * `rename_strategy: NO_RENAME` and then rename the copied tree explicitly so the
 * names follow the SAME convention used when campaigns/ad sets/ads are created
 * (`<base>`, `<base> - Ad Set`, `<base> - Ad`).
 *
 * Constraints enforced here:
 * - Ad set copy is always created in the SAME campaign (source `campaign_id`).
 * - Ad copy is always created in the SAME ad set (source `adset_id`).
 * - Status of the copies is inherited from the source (INHERITED_FROM_SOURCE).
 */

const COPY_MARKER = "Cópia";
const STATUS_OPTION = "INHERITED_FROM_SOURCE";
const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });

// Async deep copies (large campaigns) populate children eventually. App-created
// campaigns have ~1 ad set, so the copy is normally synchronous.
const TREE_POLL_ATTEMPTS = 6;
const TREE_POLL_DELAY_MS = 1500;

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

type CopyResponse = {
  copied_campaign_id?: string;
  copied_adset_id?: string;
  copied_ad_id?: string;
  // Present for deep copies; we instead read the new tree by id (deterministic).
  ad_object_ids?: Array<{
    ad_object_type?: string;
    source_id?: string;
    copied_id?: string;
  }>;
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

type AdSetTree = {
  name?: string;
  ads?: { data?: NamedNode[] };
};

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
  const tree = await metaApiCall<CampaignTree>({
    domain: "FACEBOOK",
    method: "GET",
    path: campaignId,
    params: "fields=name,adsets.limit(200){id,name,ads.limit(200){id,name}}",
    accessToken,
  });
  return tree;
}

/**
 * Map each SOURCE ad set id -> COPIED ad set id. Campaign `/copies` returns
 * this in `ad_object_ids` (campaign deep copy creates the campaign + ad sets
 * but NOT the ads — confirmed empirically). Fallback when `ad_object_ids` is
 * absent: poll the new campaign tree and match copied ad sets to source ad
 * sets by name (NO_RENAME keeps names equal until we rename).
 */
async function resolveCopiedAdsetMap(args: {
  copy: CopyResponse;
  newCampaignId: string;
  sourceAdsets: Array<{ id: string; name?: string }>;
  accessToken: string;
}): Promise<Map<string, string>> {
  const { copy, newCampaignId, sourceAdsets, accessToken } = args;
  const map = new Map<string, string>();

  for (const obj of copy.ad_object_ids ?? []) {
    if (obj.ad_object_type === "ad_set" && obj.source_id && obj.copied_id) {
      map.set(obj.source_id, obj.copied_id);
    }
  }
  if (map.size > 0) return map;

  let tree: CampaignTree = { adsets: { data: [] } };
  for (let attempt = 0; attempt < TREE_POLL_ATTEMPTS; attempt += 1) {
    tree = await getCampaignTree(newCampaignId, accessToken);
    if ((tree.adsets?.data?.length ?? 0) >= sourceAdsets.length) break;
    if (attempt < TREE_POLL_ATTEMPTS - 1) await delay(TREE_POLL_DELAY_MS);
  }
  const copied = [...(tree.adsets?.data ?? [])];
  for (const sa of sourceAdsets) {
    const idx = copied.findIndex((c) => c.name === sa.name);
    const match = idx >= 0 ? copied.splice(idx, 1)[0] : copied.shift();
    if (match) map.set(sa.id, match.id);
  }
  return map;
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
 * Native ad `/copies` into a specific (copied) ad set — same mechanism as
 * `duplicateAd`. Returns the copied ad id (creative is duplicated by Meta).
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

export type DuplicateResult = {
  id: string;
  name: string;
  sourceName: string;
};

/**
 * Deep-copies a campaign (all ad sets + ads) and renames the whole tree to
 * follow the creation convention derived from `<sourceName> - Cópia`.
 */
export async function duplicateCampaign(args: {
  accountId: string;
  campaignId: string;
  accessToken: string;
}): Promise<DuplicateResult> {
  const { accountId, campaignId, accessToken } = args;
  const act = formatAccountId(accountId);


  // Source tree up front: drives the copy name and the source ad set list.
  const sourceTree = await getCampaignTree(campaignId, accessToken);

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


  const copy = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${campaignId}/copies`,
    params: "",
    body: new URLSearchParams({
      deep_copy: "true",
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });


  const newCampaignId = copy.copied_campaign_id;
  if (!newCampaignId) throw missingCopyIdError("da campanha");

  // Campaign `/copies` copies the campaign + ad sets but NOT the ads (Meta
  // returns only `campaign`/`ad_set` in `ad_object_ids`). So copy each ad
  // explicitly into its corresponding copied ad set.
  const sourceAdsets = sourceTree.adsets?.data ?? [];
  const adsetMap = await resolveCopiedAdsetMap({
    copy,
    newCampaignId,
    sourceAdsets,
    accessToken,
  });


  const copiedAdsBySourceAdset = new Map<string, string[]>();
  let totalAds = 0;
  for (const sa of sourceAdsets) {
    const targetAdsetId = adsetMap.get(sa.id);
    if (!targetAdsetId) {
      continue;
    }
    const sourceAds = await listAdsetAds(sa.id, accessToken);
    const copiedIds: string[] = [];
    for (const ad of sourceAds) {
      const copiedAdId = await copyAdInto(ad.id, targetAdsetId, accessToken);
      if (copiedAdId) {
        copiedIds.push(copiedAdId);
        totalAds += 1;
      }
    }
    copiedAdsBySourceAdset.set(sa.id, copiedIds);
  }

  // Rename the whole tree following the creation naming convention.
  await renameObject(newCampaignId, newName, accessToken);

  let adIndex = 0;
  for (let i = 0; i < sourceAdsets.length; i += 1) {
    const sa = sourceAdsets[i];
    const copiedAdsetId = adsetMap.get(sa.id);
    if (!copiedAdsetId) continue;

    await renameObject(
      copiedAdsetId,
      `${newName} - Ad Set${childSuffix(sourceAdsets.length, i)}`,
      accessToken,
    );

    const copiedIds = copiedAdsBySourceAdset.get(sa.id) ?? [];
    for (const copiedAdId of copiedIds) {
      await renameObject(
        copiedAdId,
        `${newName} - Ad${childSuffix(totalAds, adIndex)}`,
        accessToken,
      );
      adIndex += 1;
    }
  }


  return {
    id: newCampaignId,
    name: newName,
    sourceName: sourceTree.name ?? "Campanha",
  };
}

/**
 * Copies an ad set (with its ads) WITHIN THE SAME campaign. The source
 * `campaign_id` is read and passed explicitly so the copy can never land in a
 * different campaign.
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

  const siblings = await metaApiCall<{ data?: NamedNode[] }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${source.campaign_id}/adsets`,
    params: "fields=name&limit=500",
    accessToken,
  });

  const newName = resolveCopyName(
    source.name ?? "Conjunto",
    (siblings.data ?? []).map((a) => a.name ?? ""),
  );

  const copy = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${adsetId}/copies`,
    params: "",
    body: new URLSearchParams({
      campaign_id: source.campaign_id,
      deep_copy: "true",
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });

  const newAdsetId = copy.copied_adset_id;
  if (!newAdsetId) throw missingCopyIdError("do conjunto");

  let adsetTree: AdSetTree = {};
  for (let attempt = 0; attempt < TREE_POLL_ATTEMPTS; attempt += 1) {
    adsetTree = await metaApiCall<AdSetTree>({
      domain: "FACEBOOK",
      method: "GET",
      path: newAdsetId,
      params: "fields=name,ads.limit(200){id,name}",
      accessToken,
    });
    if ((adsetTree.ads?.data?.length ?? 0) > 0) break;
    if (attempt < TREE_POLL_ATTEMPTS - 1) await delay(TREE_POLL_DELAY_MS);
  }

  await renameObject(newAdsetId, newName, accessToken);

  const ads = adsetTree.ads?.data ?? [];
  for (let i = 0; i < ads.length; i += 1) {
    await renameObject(
      ads[i].id,
      `${newName} - Ad${childSuffix(ads.length, i)}`,
      accessToken,
    );
  }

  return {
    id: newAdsetId,
    name: newName,
    sourceName: source.name ?? "Conjunto",
  };
}

/**
 * Copies an ad WITHIN THE SAME ad set. The source `adset_id` is read and passed
 * explicitly so the copy can never land in a different ad set.
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

  const copy = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${adId}/copies`,
    params: "",
    body: new URLSearchParams({
      adset_id: source.adset_id,
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });

  const newAdId = copy.copied_ad_id;
  if (!newAdId) throw missingCopyIdError("do anúncio");

  await renameObject(newAdId, newName, accessToken);

  return {
    id: newAdId,
    name: newName,
    sourceName: source.name ?? "Anúncio",
  };
}
