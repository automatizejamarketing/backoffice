/**
 * AI campaign creation via filtered duplication (ADR 0023).
 *
 * When the account has a proven mold, the wizard duplicates the proven ads from the elected campaign
 * instead of rebuilding the tree from configuration + new media (ADR 0022). Issue 02: the user
 * picks which proven ads to keep via `keepAdIds`; absent = all proven ads in the campaign.
 */
import {
  DuplicateAtomicError,
  duplicateProvenCampaign,
  computeDuplicationBudget,
  type DuplicateProvenCampaignResult,
  type DuplicateProvenCampaignReports,
} from "@/lib/meta-business/duplicate";
import { metaApiCall } from "@/lib/meta-business/api";
import { AI_PLACEMENT_ADAPTATION } from "@/lib/meta-business/creative-features";
import { buildConventionalCampaignName, buildConventionalAdName } from "../campaign-naming";
import { createAd } from "../creation/create-ad";
import { deleteMetaObject } from "../creation/delete";
import { localIssue, type CreateIssue } from "../creation/types";
import {
  INSTAGRAM_PLACEMENTS,
  placementsToTargetingFields,
  reviewPlacementsFromMode,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import { updateAdSet } from "../update/update-ad-set";
import { readAdSet } from "../update/read-current";
import type { MetaCtx } from "@/lib/meta-business/insights";
import {
  type PlanAnswers,
  type PlanMedia,
  MAX_MEDIAS,
  needsTexts,
  creativeForMedia,
  registrableDomain,
} from "./build-tree";
import { readMold, type CampaignMold } from "./read-mold";
import { listProvenAdsInCampaign, provenAdIds, type ProvenAdRef } from "./proven-ads";
import type { MoldRef } from "./pick-mold";
import {
  MoldNotFoundError,
  type AccountLimits,
  type ReviewSummary,
  verifyMold,
} from "./plan-campaign";

export type DuplicationPrepared = {
  mold: CampaignMold;
  ref: MoldRef;
  provenAds: ProvenAdRef[];
  /** Proven ads the user chose to keep — a subset of `provenAds`. */
  selectedProvenAds: ProvenAdRef[];
  keepAdIds: string[];
  campaignName: string;
  issues: CreateIssue[];
};

function resolveKeepAdIds(
  provenAds: ProvenAdRef[],
  requested: string[] | undefined,
): { keepAdIds: string[]; selectedProvenAds: ProvenAdRef[] } {
  const provenIdSet = new Set(provenAdIds(provenAds));
  const keepAdIds =
    requested != null
      ? requested.filter((id) => provenIdSet.has(id))
      : provenAdIds(provenAds);
  const keepSet = new Set(keepAdIds);
  const selectedProvenAds = provenAds.filter((ad) => keepSet.has(ad.adId));
  return { keepAdIds, selectedProvenAds };
}

/**
 * The top best-first proven ad the user kept — the winner whose ad set hosts any new media (ADR
 * 0023). `provenAds` is already sorted best-first, so the first kept one is the winner.
 */
function topKeptProvenAd(
  provenAds: ProvenAdRef[],
  keepAdIds: string[],
): ProvenAdRef | undefined {
  const keepSet = new Set(keepAdIds);
  return provenAds.find((ad) => keepSet.has(ad.adId));
}

/** Winning source ad set for new media — the top kept proven ad's set, or the fallback (ADR 0023). */
function winningSourceAdSetId(
  provenAds: ProvenAdRef[],
  keepAdIds: string[],
  fallbackAdSetId: string,
): string {
  return topKeptProvenAd(provenAds, keepAdIds)?.adSetId ?? fallbackAdSetId;
}

/**
 * Whether the ad set new media would land in is Dynamic Creative. That set is the winning ad set
 * (the top kept proven ad's set), NOT the elected ad's set — so deselecting the top-ROAS ad
 * re-points this check at the new winner. With no kept ad (new media only) the winner falls back to
 * the elected ad's set, whose flag lives on the mold (ADR 0023 ticket 06).
 */
function winningAdSetIsDynamicCreative(
  provenAds: ProvenAdRef[],
  keepAdIds: string[],
  mold: CampaignMold,
): boolean {
  const topKept = topKeptProvenAd(provenAds, keepAdIds);
  return topKept ? topKept.isDynamicCreative : mold.adSet.isDynamicCreative;
}

function winningAdSetWouldBeCopied(
  provenAds: ProvenAdRef[],
  keepAdIds: string[],
  winningSourceAdSetId: string,
): boolean {
  const keepSet = new Set(keepAdIds);
  return provenAds.some(
    (ad) => keepSet.has(ad.adId) && ad.adSetId === winningSourceAdSetId,
  );
}

function copiedAdSetForSource(
  copiedAdSets: DuplicateProvenCampaignResult["copiedAdSets"],
  sourceAdSetId: string,
): string | undefined {
  return copiedAdSets.find((row) => row.sourceAdSetId === sourceAdSetId)?.copiedAdSetId;
}

function reviewMedias(medias: PlanMedia[]): ReviewSummary["medias"] {
  return medias.map((media) => ({
    kind:
      media.kind === "instagram_post"
        ? ("instagram_post" as const)
        : media.kind === "video"
          ? ("video" as const)
          : ("image" as const),
    ...(media.kind === "video" && media.thumbnailUrl
      ? { preview: media.thumbnailUrl }
      : media.kind === "image"
        ? { preview: media.imageUrl }
        : {}),
  }));
}

function newMediaIssues(
  answers: PlanAnswers,
  mold: CampaignMold,
): CreateIssue[] {
  const issues: CreateIssue[] = [];
  if (answers.medias.length === 0) return issues;

  if (answers.medias.length > MAX_MEDIAS) {
    issues.push(
      localIssue(
        "campaign",
        "TOO_MANY_MEDIAS",
        `Esta campanha aceita no máximo ${MAX_MEDIAS} mídias novas.`,
        `Escolha até ${MAX_MEDIAS} mídias.`,
        ["medias"],
      ),
    );
  }

  if (!needsTexts(answers.medias)) return issues;

  const headline = answers.texts?.headline?.trim();
  const message = answers.texts?.message?.trim();
  const link = answers.texts?.link?.trim() ?? mold.destination.link;

  if (!headline || !message) {
    issues.push(
      localIssue(
        "ad",
        "AD_TEXT_REQUIRED",
        "O anúncio precisa de um título e de uma legenda.",
        "Escreva o título e a legenda — ou descreva sua oferta e deixe a IA escrever.",
        ["texts"],
      ),
    );
  }
  if (!link) {
    issues.push(
      localIssue(
        "ad",
        "AD_LINK_REQUIRED",
        "O anúncio precisa de um link de destino.",
        "Informe para onde o anúncio deve levar (site, cardápio, WhatsApp).",
        ["texts", "link"],
      ),
    );
  }

  return issues;
}

async function prepareDuplication(
  ctx: MetaCtx,
  clientRef: MoldRef,
  answers: PlanAnswers,
  limits: AccountLimits = {},
): Promise<DuplicationPrepared> {
  const mold = await readMold(ctx, clientRef);
  const ref = await verifyMold(ctx, clientRef, mold);
  mold.ref = ref;

  const campaignDaily =
    mold.campaign.budgetMode === "CBO"
      ? (mold.campaign.dailyBudgetCents ?? 0) / 100 || null
      : null;

  const provenAds = await listProvenAdsInCampaign(ctx, ref, campaignDaily);
  const { keepAdIds, selectedProvenAds } = resolveKeepAdIds(
    provenAds,
    answers.keepAdIds,
  );

  const campaignName = buildConventionalCampaignName(
    mold.campaign.objective,
    answers.niche,
  );

  const issues: CreateIssue[] = [];
  const hasNewMedia = answers.medias.length > 0;
  const hasKeptAds = keepAdIds.length > 0;

  if (provenAds.length === 0 && !hasNewMedia) {
    issues.push(
      localIssue(
        "campaign",
        "NO_PROVEN_ADS",
        "Não encontramos anúncios provados nesta campanha para duplicar.",
        "Escolha outra conta ou crie a campanha pelo fluxo manual.",
        ["mold"],
      ),
    );
  } else if (!hasKeptAds && !hasNewMedia) {
    issues.push(
      localIssue(
        "campaign",
        "NO_ADS_TO_CREATE",
        "Não há nada para criar: nenhum anúncio provado marcado e nenhuma mídia nova.",
        "Marque ao menos um anúncio provado ou adicione uma mídia nova.",
        ["mold", "medias"],
      ),
    );
  }

  if (hasNewMedia && winningAdSetIsDynamicCreative(provenAds, keepAdIds, mold)) {
    issues.push(
      localIssue(
        "adset",
        "DYNAMIC_CREATIVE_NEW_MEDIA",
        "O conjunto vencedor — onde as mídias novas entrariam — usa Criativo Dinâmico, e a Meta não permite adicionar mídias novas nesse formato.",
        "Remova as mídias novas para duplicar só os anúncios provados (eles continuam sendo copiados normalmente). Se quiser testar mídias novas, use como base um anúncio provado cujo conjunto não seja Criativo Dinâmico.",
        ["medias"],
      ),
    );
  }

  issues.push(...newMediaIssues(answers, mold));

  const adSetCount =
    hasKeptAds && selectedProvenAds.length > 0
      ? new Set(selectedProvenAds.map((ad) => ad.adSetId)).size
      : hasNewMedia
        ? 1
        : 0;
  const budget = computeDuplicationBudget({
    dailyBudgetMajor: answers.dailyBudget,
    adSetCount,
  });
  const smallest = Math.min(...budget.slices);
  const floor = limits.minDailyBudgetCents;

  if (
    mold.campaign.budgetMode === "ABO" &&
    floor != null &&
    adSetCount > 0 &&
    smallest < floor
  ) {
    const perAdSet = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: ctx.currency,
    }).format(smallest / 100);
    const minimum = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: ctx.currency,
    }).format(floor / 100);
    issues.push(
      localIssue(
        "adset",
        "ADSET_BUDGET_BELOW_MINIMUM",
        adSetCount > 1
          ? `Com ${adSetCount} conjuntos, cada um ficaria com ${perAdSet} por dia — abaixo do mínimo de ${minimum} que a Meta aceita nesta conta.`
          : `${perAdSet} por dia está abaixo do mínimo de ${minimum} que a Meta aceita nesta conta.`,
        "Aumente o orçamento diário.",
        ["daily_budget"],
      ),
    );
  }

  return {
    mold,
    ref,
    provenAds,
    selectedProvenAds,
    keepAdIds,
    campaignName,
    issues,
  };
}

const PLACEMENT_KEYS = [
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "audience_network_positions",
  "messenger_positions",
] as const;

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

type MetaGeoEntry = {
  name?: string;
  key?: string;
  address_string?: string;
  radius?: number;
  distance_unit?: string;
};

/** A place the review can name, with its radius normalised to km (Meta reports km or miles). */
function namedGeoLocations(
  geo: Record<string, unknown>,
): Array<{ label: string; radiusKm?: number }> | undefined {
  const toKm = (entry: MetaGeoEntry): number | undefined =>
    entry.radius == null
      ? undefined
      : entry.distance_unit === "mile"
        ? Math.round(entry.radius * 1.609)
        : Math.round(entry.radius);

  const out: Array<{ label: string; radiusKm?: number }> = [];
  // Custom addresses and cities are the ones a business owner recognises; regions/countries stay as
  // the counts (naming "São Paulo (estado)" adds nothing the count didn't already say).
  for (const key of ["custom_locations", "cities"] as const) {
    const entries = Array.isArray(geo[key]) ? (geo[key] as MetaGeoEntry[]) : [];
    for (const entry of entries) {
      const label = entry.address_string ?? entry.name ?? entry.key;
      if (label) out.push({ label, radiusKm: toKm(entry) });
    }
  }
  return out.length ? out : undefined;
}

/**
 * Meta's raw targeting → the facts the review needs (counts + named places), never prose: the UI
 * writes the words (the app is pt-BR + en). The elected mold's ad set is the audience being copied.
 * This is the ONE describeAudience — it was duplicated near-verbatim in plan-campaign.ts, whose copy
 * was dead once planCampaign became a thin delegator (ADR 0023 ticket 06).
 */
function describeAudience(mold: CampaignMold): ReviewSummary["audience"] {
  const t = mold.adSet.targeting;
  const geo = (t.geo_locations ?? {}) as Record<string, unknown>;
  const automation = (t.targeting_automation ?? {}) as { advantage_audience?: number };
  const genders = (t.genders ?? []) as number[];
  const locations = namedGeoLocations(geo);

  return {
    geo: {
      customLocations: count(geo.custom_locations),
      cities: count(geo.cities),
      regions: count(geo.regions),
      countries: count(geo.countries),
      ...(locations ? { locations } : {}),
    },
    advantagePlus: automation.advantage_audience === 1,
    interestGroups: count(t.flexible_spec),
    customAudiences: count(t.custom_audiences),
    placements: {
      // No placement keys at all = Meta chooses them (Advantage+ placements).
      automatic: !PLACEMENT_KEYS.some((key) => count(t[key]) > 0),
      platforms: (t.publisher_platforms ?? []) as string[],
      ...(count(t.facebook_positions)
        ? { facebookPositions: t.facebook_positions as string[] }
        : {}),
      ...(count(t.instagram_positions)
        ? { instagramPositions: t.instagram_positions as string[] }
        : {}),
    },
    ...(typeof t.age_min === "number" ? { ageMin: t.age_min } : {}),
    ...(typeof t.age_max === "number" ? { ageMax: t.age_max } : {}),
    ...(genders.length ? { genders } : {}),
  };
}

function resolveReviewSchedule(
  mold: CampaignMold,
  answers: PlanAnswers,
): ReviewSummary["schedule"] {
  if (answers.deliveryMode === "all_day") {
    return { mode: "continuous", blocks: 0 };
  }
  if (
    answers.deliveryMode === "specific_hours" &&
    answers.scheduleBlocks &&
    answers.scheduleBlocks.length > 0
  ) {
    return {
      mode: "dayparting",
      blocks: answers.scheduleBlocks.length,
      dayParts: answers.scheduleBlocks,
    };
  }
  if (!mold.adSet.schedule) return undefined;
  return {
    mode: mold.adSet.schedule.mode,
    blocks: mold.adSet.schedule.blocks?.length ?? 0,
    ...(mold.adSet.schedule.blocks?.length
      ? { dayParts: mold.adSet.schedule.blocks }
      : {}),
  };
}

/**
 * Apply the review's delivery-hours override onto every duplicated ad set before activation.
 */
async function applyDeliveryScheduleOverride(args: {
  accessToken: string;
  adSetIds: string[];
  answers: PlanAnswers;
}): Promise<void> {
  const { accessToken, adSetIds, answers } = args;
  if (answers.deliveryMode == null) return;

  const body = new URLSearchParams();
  if (
    answers.deliveryMode === "specific_hours" &&
    answers.scheduleBlocks &&
    answers.scheduleBlocks.length > 0
  ) {
    body.set("pacing_type", JSON.stringify(["day_parting"]));
    body.set(
      "adset_schedule",
      JSON.stringify(
        answers.scheduleBlocks.map((block) => ({
          days: block.days,
          start_minute: block.startMinute,
          end_minute: block.endMinute,
          timezone_type: "ADVERTISER",
        })),
      ),
    );
  } else {
    body.set("pacing_type", JSON.stringify(["standard"]));
    body.set("adset_schedule", JSON.stringify([]));
  }

  for (const adSetId of adSetIds) {
    await metaApiCall<{ success?: boolean }>({
      domain: "FACEBOOK",
      method: "POST",
      path: adSetId,
      params: "",
      body,
      accessToken,
    });
  }
}

const PLACEMENT_TARGETING_KEYS = [
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "audience_network_positions",
  "messenger_positions",
  "threads_positions",
  "device_platforms",
] as const;

/**
 * Apply the review's placement override onto every duplicated ad set before activation.
 *
 * Marketing API v25.0: Advantage+ placements is the ABSENCE of placement fields.
 * Sending publisher_platforms / facebook_positions / instagram_positions turns it off.
 */
async function applyPlacementsOverride(args: {
  accessToken: string;
  adSetIds: string[];
  answers: PlanAnswers;
}): Promise<void> {
  const { accessToken, adSetIds, answers } = args;
  if (answers.placementsMode == null) return;

  for (const adSetId of adSetIds) {
    const snap = await readAdSet(adSetId, accessToken);
    const targeting: Record<string, unknown> = snap.targeting
      ? (JSON.parse(JSON.stringify(snap.targeting)) as Record<string, unknown>)
      : {};
    const platforms = (targeting.publisher_platforms as string[] | undefined) ?? [];
    const wasInstagramOnly =
      platforms.length === 1 && platforms[0] === "instagram";

    for (const key of PLACEMENT_TARGETING_KEYS) {
      delete targeting[key];
    }

    if (answers.placementsMode === "automatic") {
      // Advantage+ would also spend on Facebook. An IG-profile destination must
      // stay pinned — Meta stores an empty set as publisher_platforms: [].
      if (wasInstagramOnly) {
        Object.assign(
          targeting,
          placementsToTargetingFields(INSTAGRAM_PLACEMENTS),
        );
      }
    } else {
      const selected = (answers.selectedPlacements ?? []) as PlacementKey[];
      if (selected.length === 0) {
        throw new Error("manual placements require at least one surface");
      }
      const allowed = wasInstagramOnly
        ? selected.filter((key) =>
            (INSTAGRAM_PLACEMENTS as readonly PlacementKey[]).includes(key),
          )
        : selected;
      if (allowed.length === 0) {
        throw new Error("no allowed placements remain for this ad set");
      }
      Object.assign(targeting, placementsToTargetingFields(allowed));
    }

    const result = await updateAdSet({
      adSetId,
      accessToken,
      snapshot: snap,
      targetingRaw: targeting,
    });
    if (!result.ok) {
      throw new Error(result.issues[0]?.reason ?? "placement override failed");
    }
  }
}

function buildDuplicationReview(
  ctx: MetaCtx,
  prepared: DuplicationPrepared,
  answers: PlanAnswers,
): ReviewSummary {
  const { mold, ref, selectedProvenAds, campaignName } = prepared;
  const hasNewMedia = answers.medias.length > 0;
  const adSetCount =
    selectedProvenAds.length > 0
      ? new Set(selectedProvenAds.map((ad) => ad.adSetId)).size
      : hasNewMedia
        ? 1
        : 0;
  // Budget AMOUNTS + flight length from the SAME computation the engine writes — so the numbers the
  // review shows cannot drift from what gets published (ADR 0023 ticket 06). The lifetime-vs-daily
  // mode below is still derived from the mold, matching how the engine reads the source campaign.
  const budget = computeDuplicationBudget({
    dailyBudgetMajor: answers.dailyBudget,
    adSetCount,
  });
  const isCbo = mold.campaign.budgetMode === "CBO";
  const scheduleSummary = resolveReviewSchedule(mold, answers);
  /**
   * Will the COPY run on a lifetime budget? The engine reproduces the proven campaign's own shape
   * (`duplicate.ts`: campaign lifetime under CBO, ad-set lifetime or existing day-parting under ABO),
   * and Meta only accepts an hours grid on a lifetime budget — so this is also the answer to "can the
   * user pick delivery hours here at all".
   */
  //
  // It used to read the answers' own day-parting too, which made the review promise a lifetime total
  // the engine would not write when the proven campaign ran on a daily budget — and, once delivery
  // hours stopped being optional, promise an hours grid Meta refuses outright.
  const copyUsesLifetime = isCbo
    ? mold.campaign.lifetimeBudgetCents != null
    : mold.adSet.lifetimeBudgetCents != null || mold.adSet.schedule != null;

  return {
    currency: ctx.currency,
    basedOn: {
      kind: ref.kind,
      adName: ref.adName,
      spend: ref.metrics.spend,
      roas: ref.metrics.roas,
      costPerResult: ref.metrics.costPerResult,
      resultLabel: ref.metrics.resultLabel,
      currency: ref.metrics.currency,
    },
    objective: mold.campaign.objective,
    campaignName,
    structure: {
      adSets: adSetCount,
      adsPerAdSet: Math.max(
        1,
        Math.ceil(selectedProvenAds.length / Math.max(1, adSetCount)),
      ),
    },
    budget: {
      mode: mold.campaign.budgetMode,
      dailyCents: budget.dailyCents,
      ...(!isCbo && adSetCount > 1 ? { perAdSetDailyCents: budget.slices[0] } : {}),
      ...(copyUsesLifetime ? { lifetimeCents: budget.lifetimeCents } : {}),
      daypartingAllowed: copyUsesLifetime,
    },
    medias: reviewMedias(answers.medias),
    ...(answers.medias.length > 0 && needsTexts(answers.medias) && answers.texts
      ? {
          texts: {
            headline: answers.texts.headline,
            message: answers.texts.message,
            ctaType: answers.texts.ctaType ?? mold.destination.ctaType ?? "LEARN_MORE",
            link: answers.texts.link ?? mold.destination.link ?? "",
          },
        }
      : {}),
    provenAds: selectedProvenAds.map((ad) => ({
      adId: ad.adId,
      adName: ad.adName,
      thumbnailUrl: ad.thumbnailUrl,
      spend: ad.spend,
      roas: ad.roas,
      costPerResult: ad.costPerResult,
      resultLabel: ad.resultLabel,
    })),
    audience: {
      ...describeAudience(mold),
      ...(answers.placementsMode
        ? {
            placements: reviewPlacementsFromMode(
              answers.placementsMode,
              answers.selectedPlacements ?? [],
            ),
          }
        : {}),
    },
    ...(scheduleSummary ? { schedule: scheduleSummary } : {}),
    identity: {
      ...(mold.identity.pageId ? { pageId: mold.identity.pageId } : {}),
      ...(mold.identity.instagramUserId
        ? { instagramUserId: mold.identity.instagramUserId }
        : {}),
    },
    ...(mold.pixelId ? { pixelId: mold.pixelId } : {}),
  };
}

export type DuplicationPlanResult = {
  ok: boolean;
  review: ReviewSummary;
  issues: CreateIssue[];
};

export async function planDuplicatedCampaign(
  ctx: MetaCtx,
  clientRef: MoldRef,
  answers: PlanAnswers,
  limits: AccountLimits = {},
): Promise<DuplicationPlanResult> {
  const prepared = await prepareDuplication(ctx, clientRef, answers, limits);
  return {
    ok: prepared.issues.length === 0,
    review: buildDuplicationReview(ctx, prepared, answers),
    issues: prepared.issues,
  };
}

export type DuplicationPublishResult =
  | {
      ok: true;
      campaignId: string;
      adSetIds: string[];
      adIds: string[];
      reports?: DuplicateProvenCampaignReports;
    }
  | {
      ok: false;
      issues: CreateIssue[];
      rolledBack: boolean;
      orphanIds?: string[];
    };

async function createNewMediaAds(args: {
  ctx: MetaCtx;
  mold: CampaignMold;
  answers: PlanAnswers;
  campaignName: string;
  winningCopiedAdSetId: string;
}): Promise<{ ok: true; adIds: string[] } | { ok: false; issues: CreateIssue[] }> {
  const { ctx, mold, answers, campaignName, winningCopiedAdSetId } = args;
  const medias = answers.medias;
  if (medias.length === 0) return { ok: true, adIds: [] };

  const link = answers.texts?.link?.trim() ?? mold.destination.link;
  const conversionDomain =
    registrableDomain(link) ?? mold.conversionDomain ?? undefined;
  const createdAdIds: string[] = [];

  for (let index = 0; index < medias.length; index++) {
    const media = medias[index];
    const result = await createAd({
      adAccountId: ctx.adAccountId,
      accessToken: ctx.accessToken,
      adSetId: winningCopiedAdSetId,
      name: buildConventionalAdName(campaignName, index, medias.length),
      status: "PAUSED",
      creative: creativeForMedia(media, mold, answers),
      // A mídia nova do usuário é justamente a que mais precisa: ela nasce num
      // formato só e vai para os 6 posicionamentos.
      placementAdaptation: answers.placementAdaptation ?? AI_PLACEMENT_ADAPTATION,
      ...(conversionDomain ? { conversionDomain } : {}),
      ...(mold.adSet.optimizationGoal
        ? { optimizationGoal: mold.adSet.optimizationGoal }
        : {}),
    });

    if (!result.ok) {
      return { ok: false, issues: result.issues };
    }
    createdAdIds.push(result.data.id);
  }

  return { ok: true, adIds: createdAdIds };
}

async function activateDuplicatedTree(args: {
  accessToken: string;
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  activationFields: DuplicateProvenCampaignResult["activationFields"];
}): Promise<void> {
  const activate = (id: string, fields: Record<string, string> = {}) =>
    metaApiCall<{ success?: boolean }>({
      domain: "FACEBOOK",
      method: "POST",
      path: id,
      params: "",
      body: new URLSearchParams({ ...fields, status: "ACTIVE" }),
      accessToken: args.accessToken,
    });
  for (const adId of args.adIds) await activate(adId);
  for (const adSetId of args.adSetIds) {
    await activate(adSetId, args.activationFields.adSets[adSetId]);
  }
  await activate(args.campaignId, args.activationFields.campaign);
}

export async function createDuplicatedCampaign(
  ctx: MetaCtx,
  clientRef: MoldRef,
  answers: PlanAnswers,
  limits: AccountLimits = {},
): Promise<DuplicationPublishResult> {
  const prepared = await prepareDuplication(ctx, clientRef, answers, limits);
  if (prepared.issues.length > 0) {
    return { ok: false, issues: prepared.issues, rolledBack: false };
  }

  const promotionUrl =
    answers.texts?.link?.trim() || prepared.mold.destination.link;

  const winningSource = winningSourceAdSetId(
    prepared.provenAds,
    prepared.keepAdIds,
    prepared.ref.adSetId,
  );
  const alwaysCopyAdSetIds =
    answers.medias.length > 0 &&
    !winningAdSetWouldBeCopied(
      prepared.provenAds,
      prepared.keepAdIds,
      winningSource,
    )
      ? [winningSource]
      : undefined;

  try {
    const result = await duplicateProvenCampaign({
      accountId: ctx.adAccountId,
      campaignId: prepared.ref.campaignId,
      accessToken: ctx.accessToken,
      keepAdIds: prepared.keepAdIds,
      ...(alwaysCopyAdSetIds ? { alwaysCopyAdSetIds } : {}),
      dailyBudgetMajor: answers.dailyBudget,
      campaignName: prepared.campaignName,
      ...(promotionUrl ? { fallbackPromotionUrl: promotionUrl } : {}),
      // Sem este campo o criativo copiado herda o do anúncio de origem, e um
      // criativo que nasceu neste produto tem TODAS as features em OPT_OUT —
      // ou seja, a campanha da IA sairia sem adaptação de posicionamento.
      placementAdaptation: answers.placementAdaptation ?? AI_PLACEMENT_ADAPTATION,
    });

    const winningCopiedAdSetId = copiedAdSetForSource(
      result.copiedAdSets,
      winningSource,
    );
    if (!winningCopiedAdSetId) {
      const deleted = await deleteMetaObject(
        result.campaignId,
        ctx.accessToken,
      );
      return {
        ok: false,
        issues: [
          localIssue(
            "adset",
            "WINNING_ADSET_MISSING",
            "Não encontramos o conjunto vencedor duplicado para as mídias novas.",
            "Tente novamente ou escolha outro anúncio provado como base.",
            [],
          ),
        ],
        rolledBack: deleted,
        ...(!deleted ? { orphanIds: [result.campaignId] } : {}),
      };
    }

    const newMedia = await createNewMediaAds({
      ctx,
      mold: prepared.mold,
      answers,
      campaignName: prepared.campaignName,
      winningCopiedAdSetId,
    });

    if (!newMedia.ok) {
      const deleted = await deleteMetaObject(result.campaignId, ctx.accessToken);
      return {
        ok: false,
        issues: newMedia.issues,
        rolledBack: deleted,
        ...(!deleted ? { orphanIds: [result.campaignId] } : {}),
      };
    }

    try {
      await applyDeliveryScheduleOverride({
        accessToken: ctx.accessToken,
        adSetIds: result.adSetIds,
        answers,
      });
      await applyPlacementsOverride({
        accessToken: ctx.accessToken,
        adSetIds: result.adSetIds,
        answers,
      });
    } catch {
      const deleted = await deleteMetaObject(result.campaignId, ctx.accessToken);
      return {
        ok: false,
        issues: [
          localIssue(
            "adset",
            "SCHEDULE_OVERRIDE_FAILED",
            "A campanha foi criada, mas os horários ou posicionamentos não puderam ser aplicados.",
            "Tente novamente ou ajuste depois na campanha.",
            ["adset_schedule", "targeting"],
          ),
        ],
        rolledBack: deleted,
        ...(!deleted ? { orphanIds: [result.campaignId] } : {}),
      };
    }

    const allAdIds = [...result.adIds, ...newMedia.adIds];
    try {
      await activateDuplicatedTree({
        accessToken: ctx.accessToken,
        campaignId: result.campaignId,
        adSetIds: result.adSetIds,
        adIds: allAdIds,
        activationFields: result.activationFields,
      });
    } catch {
      const deleted = await deleteMetaObject(result.campaignId, ctx.accessToken);
      return {
        ok: false,
        issues: [
          localIssue(
            "campaign",
            "ACTIVATION_FAILED",
            "A campanha foi criada, mas não pôde ser ativada com segurança.",
            "Tente novamente em alguns instantes.",
            [],
          ),
        ],
        rolledBack: deleted,
        ...(!deleted ? { orphanIds: [result.campaignId] } : {}),
      };
    }

    return {
      ok: true,
      campaignId: result.campaignId,
      adSetIds: result.adSetIds,
      adIds: allAdIds,
      ...(result.skippedAds ||
      result.skippedAdsets ||
      result.replacedInterests ||
      result.repairedCreatives ||
      result.rebuiltAdsets ||
      result.scheduleAdjusted ||
      result.scheduleAdjustFailed
        ? {
            reports: {
              ...(result.skippedAds ? { skippedAds: result.skippedAds } : {}),
              ...(result.skippedAdsets ? { skippedAdsets: result.skippedAdsets } : {}),
              ...(result.replacedInterests
                ? { replacedInterests: result.replacedInterests }
                : {}),
              ...(result.repairedCreatives
                ? { repairedCreatives: result.repairedCreatives }
                : {}),
              ...(result.rebuiltAdsets ? { rebuiltAdsets: result.rebuiltAdsets } : {}),
              ...(result.scheduleAdjusted ? { scheduleAdjusted: true } : {}),
              ...(result.scheduleAdjustFailed ? { scheduleAdjustFailed: true } : {}),
            },
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof DuplicateAtomicError) {
      return {
        ok: false,
        issues: [
          localIssue(
            "campaign",
            "DUPLICATION_FAILED",
            error.message,
            error.errorReturn.reason.solution ?? "Tente novamente em alguns instantes.",
            [],
          ),
        ],
        rolledBack: error.rolledBack,
        ...(error.orphanIds?.length ? { orphanIds: error.orphanIds } : {}),
      };
    }
    if (error instanceof MoldNotFoundError) throw error;
    throw error;
  }
}
