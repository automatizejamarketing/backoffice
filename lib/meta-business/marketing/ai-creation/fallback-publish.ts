/**
 * No-mold fallback: publish an ACTIVE campaign via createCampaignTree using the
 * same Meta fields the frontend niche creators use (sales / traffic / leads).
 */
import { metaApiCall } from "@/lib/meta-business/api";
import { getConnectedPageById } from "@/lib/meta-business/get-instagram-connected-page";
import {
  buildGeoLocationsPayload,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";
import {
  INSTAGRAM_PLACEMENTS,
  placementsToTargetingFields,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import type {
  CampaignDeliveryMode,
  CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import {
  createCampaignTree,
  type CampaignTreeResult,
} from "../creation/create-tree";
import { deleteMetaObject } from "../creation/delete";
import { localIssue, type CreateIssue } from "../creation/types";
import type { AdCreativeInput } from "../creation/create-ad";
import {
  buildConventionalAdName,
  buildConventionalAdSetName,
  buildConventionalCampaignName,
} from "../campaign-naming";
import {
  DEFAULT_FLIGHT_DAYS,
  MAX_MEDIAS,
  needsTexts,
  registrableDomain,
  type PlanMedia,
  type PlanTexts,
} from "./build-tree";
import type { PublishResult } from "./publish-campaign";

export type FallbackNiche =
  | "food_service"
  | "retail"
  | "real_estate_broker"
  | "service"
  | "insurance_broker"
  | "outros";

export type FallbackObjective = "sales" | "followers" | "leads";

export type FallbackPeriod = {
  startTime: string;
  endTime: string;
};

export type FallbackPublishInput = {
  niche: FallbackNiche;
  objective: FallbackObjective;
  dailyBudget: number;
  media: PlanMedia[];
  texts?: PlanTexts;
  promotionUrl?: string;
  locations: SelectedGeoLocation[];
  pageId: string;
  instagramUserId?: string | null;
  pixelId?: string | null;
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
  period?: FallbackPeriod;
  /**
   * Advantage+ = omit placement fields. Manual = send publisher_platforms /
   * *_positions. Followers (traffic) stays Instagram-only either way.
   */
  placementsMode?: "automatic" | "manual";
  selectedPlacements?: PlacementKey[];
};

export type FallbackConfig = {
  metaObjective: "OUTCOME_SALES" | "OUTCOME_TRAFFIC" | "OUTCOME_LEADS";
  requiresPixel: boolean;
  requiresPromotionUrl: boolean;
  requiresInstagram: boolean;
  acceptsDeliverySchedule: boolean;
  usesInclusiveMinusOneDefault: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveFallbackConfig(
  niche: FallbackNiche,
  objective: FallbackObjective,
): FallbackConfig | { error: string } {
  const normalizedNiche = niche === "service" ? "insurance_broker" : niche;

  if (objective === "sales") {
    if (
      normalizedNiche !== "food_service" &&
      normalizedNiche !== "retail" &&
      normalizedNiche !== "outros"
    ) {
      return {
        error: `Campanhas de vendas não estão disponíveis para o nicho ${niche}.`,
      };
    }
    const periodAndDelivery =
      normalizedNiche === "food_service" || normalizedNiche === "outros";
    return {
      metaObjective: "OUTCOME_SALES",
      requiresPixel: true,
      requiresPromotionUrl: true,
      requiresInstagram: false,
      acceptsDeliverySchedule: periodAndDelivery,
      usesInclusiveMinusOneDefault: periodAndDelivery,
    };
  }

  if (objective === "followers") {
    return {
      metaObjective: "OUTCOME_TRAFFIC",
      requiresPixel: false,
      requiresPromotionUrl: false,
      requiresInstagram: true,
      acceptsDeliverySchedule: false,
      usesInclusiveMinusOneDefault: false,
    };
  }

  if (
    normalizedNiche !== "retail" &&
    normalizedNiche !== "insurance_broker" &&
    normalizedNiche !== "real_estate_broker"
  ) {
    return {
      error: `Campanhas de leads não estão disponíveis para o nicho ${niche}.`,
    };
  }

  return {
    metaObjective: "OUTCOME_LEADS",
    requiresPixel: false,
    requiresPromotionUrl: false,
    requiresInstagram: false,
    acceptsDeliverySchedule: false,
    usesInclusiveMinusOneDefault: false,
  };
}

export function fallbackIssues(
  input: FallbackPublishInput,
  config: FallbackConfig,
): CreateIssue[] {
  const issues: CreateIssue[] = [];

  if (!input.dailyBudget || input.dailyBudget <= 0) {
    issues.push(
      localIssue(
        "campaign",
        "FALLBACK_BUDGET_REQUIRED",
        "Informe um orçamento diário maior que zero.",
        "Ajuste o orçamento diário.",
        ["dailyBudget"],
      ),
    );
  }

  if (!input.media?.length) {
    issues.push(
      localIssue(
        "ad",
        "FALLBACK_MEDIA_REQUIRED",
        "A campanha precisa de ao menos uma mídia.",
        "Envie uma imagem, um vídeo ou um post do Instagram.",
        ["media"],
      ),
    );
  } else if (input.media.length > MAX_MEDIAS) {
    issues.push(
      localIssue(
        "campaign",
        "TOO_MANY_MEDIAS",
        `Esta campanha aceita no máximo ${MAX_MEDIAS} mídias.`,
        `Escolha até ${MAX_MEDIAS} mídias.`,
        ["media"],
      ),
    );
  }

  if (config.requiresPixel && !input.pixelId) {
    issues.push(
      localIssue(
        "adset",
        "FALLBACK_PIXEL_REQUIRED",
        "Uma campanha de vendas precisa de um pixel para medir as compras.",
        "Selecione o pixel da conta.",
        ["pixelId"],
      ),
    );
  }

  if (!input.pageId) {
    issues.push(
      localIssue(
        "ad",
        "FALLBACK_IDENTITY_REQUIRED",
        "O anúncio precisa de uma Página do Facebook para aparecer como anunciante.",
        "Selecione a página.",
        ["pageId"],
      ),
    );
  }

  if (
    (config.requiresInstagram ||
      (input.media ?? []).some((media) => media.kind === "instagram_post")) &&
    !input.instagramUserId
  ) {
    issues.push(
      localIssue(
        "ad",
        "FALLBACK_INSTAGRAM_REQUIRED",
        config.requiresInstagram
          ? "Uma campanha de alcance e seguidores leva as pessoas até o perfil do Instagram."
          : "Um boost de post do Instagram precisa da conta conectada.",
        "Escolha uma Página com Instagram conectado.",
        ["instagramUserId"],
      ),
    );
  }

  if (!input.locations?.length) {
    issues.push(
      localIssue(
        "adset",
        "FALLBACK_LOCATION_REQUIRED",
        "Sem localização o anúncio seria exibido no Brasil inteiro.",
        "Escolha onde o anúncio deve aparecer.",
        ["locations"],
      ),
    );
  }

  const promotionUrl = input.texts?.link?.trim() || input.promotionUrl?.trim();
  if (config.requiresPromotionUrl && !promotionUrl) {
    issues.push(
      localIssue(
        "ad",
        "FALLBACK_URL_REQUIRED",
        "O anúncio precisa de um link de destino.",
        "Informe para onde o anúncio deve levar (site, cardápio, WhatsApp).",
        ["promotionUrl"],
      ),
    );
  }

  if (needsTexts(input.media ?? []) && input.objective !== "followers") {
    const headline = input.texts?.headline?.trim();
    const message = input.texts?.message?.trim();
    if (!headline || !message) {
      issues.push(
        localIssue(
          "ad",
          "AD_TEXT_REQUIRED",
          "O anúncio precisa de um título e de uma legenda.",
          "Escreva o título e a legenda.",
          ["texts"],
        ),
      );
    }
  }

  return issues;
}

function inclusiveCampaignDays(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / DAY_MS) + 1);
}

function resolveFlight(
  input: FallbackPublishInput,
  config: FallbackConfig,
  now: Date,
): { startTime: string; endTime: string; lifetimeCents: number } {
  if (input.period?.startTime && input.period?.endTime) {
    const start = new Date(input.period.startTime);
    const end = new Date(input.period.endTime);
    const days = inclusiveCampaignDays(start, end);
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      lifetimeCents: Math.round(input.dailyBudget * days * 100),
    };
  }

  const defaultDays = config.usesInclusiveMinusOneDefault
    ? DEFAULT_FLIGHT_DAYS - 1
    : DEFAULT_FLIGHT_DAYS;
  const start = now;
  const end = new Date(now.getTime() + defaultDays * DAY_MS);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    lifetimeCents: Math.round(input.dailyBudget * DEFAULT_FLIGHT_DAYS * 100),
  };
}

function resolvePlacementFields(
  input: FallbackPublishInput,
  config: FallbackConfig,
): Record<string, unknown> {
  const isTraffic = config.metaObjective === "OUTCOME_TRAFFIC";
  const mode = input.placementsMode ?? (isTraffic ? "manual" : "automatic");

  if (isTraffic) {
    const selected = (input.selectedPlacements ?? []).filter((key) =>
      (INSTAGRAM_PLACEMENTS as readonly PlacementKey[]).includes(key),
    );
    return placementsToTargetingFields(
      selected.length > 0 ? selected : INSTAGRAM_PLACEMENTS,
    );
  }

  if (mode === "automatic") {
    return {};
  }

  const selected = input.selectedPlacements ?? [];
  if (selected.length === 0) return {};
  return placementsToTargetingFields(selected);
}

function privacyPolicyUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return appUrl
    ? `${appUrl}/lgpd`
    : "https://www.automatizemarketing.com/lgpd";
}

async function createLeadForm(args: {
  pageId: string;
  accessToken: string;
  name: string;
}): Promise<string> {
  const privacy = privacyPolicyUrl();
  const website = privacy.replace("/lgpd", "");
  const body = new URLSearchParams();
  body.set(
    "questions",
    JSON.stringify([
      { type: "FULL_NAME", key: "full_name" },
      { type: "EMAIL", key: "email" },
      { type: "PHONE", key: "phone" },
    ]),
  );
  body.set("name", args.name);
  body.set(
    "privacy_policy",
    JSON.stringify({ url: privacy, link_text: "Política de Privacidade" }),
  );
  body.set(
    "thank_you_page",
    JSON.stringify({
      title: "Obrigado pelo seu interesse!",
      body: "Recebemos suas informações e entraremos em contato em breve.",
      button_type: "VIEW_WEBSITE",
      button_text: "Visitar site",
      website_url: website,
    }),
  );
  body.set("locale", "PT_BR");
  body.set("block_display_for_non_targeted_viewer", "true");

  const created = await metaApiCall<{ id: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${args.pageId}/leadgen_forms`,
    params: "",
    body,
    accessToken: args.accessToken,
  });
  return created.id;
}

function creativeForFallback(args: {
  media: PlanMedia;
  input: FallbackPublishInput;
  config: FallbackConfig;
  instagramProfileUrl?: string;
  leadFormId?: string;
}): AdCreativeInput {
  const { media, input, config, instagramProfileUrl, leadFormId } = args;
  const pageId = input.pageId;
  const instagramUserId = input.instagramUserId ?? "";
  const link =
    config.metaObjective === "OUTCOME_TRAFFIC"
      ? (instagramProfileUrl ?? "https://www.instagram.com")
      : config.metaObjective === "OUTCOME_LEADS"
        ? privacyPolicyUrl().replace("/lgpd", "")
        : (input.texts?.link?.trim() || input.promotionUrl?.trim() || "");

  const ctaType =
    config.metaObjective === "OUTCOME_LEADS"
      ? "SIGN_UP"
      : (input.texts?.ctaType ?? "LEARN_MORE");

  const cta = {
    type: ctaType,
    ...(link ? { link } : {}),
    ...(leadFormId ? { leadGenFormId: leadFormId } : {}),
  };

  if (media.kind === "instagram_post") {
    return {
      format: "instagram_post",
      instagramMediaId: media.instagramMediaId,
      pageId,
      instagramUserId,
      cta,
    };
  }

  if (media.kind === "video") {
    return {
      format: "video",
      pageId,
      ...(instagramUserId ? { instagramUserId } : {}),
      videoId: media.videoId,
      ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
      ...(input.texts?.message ? { message: input.texts.message } : {}),
      ...(input.texts?.headline ? { headline: input.texts.headline } : {}),
      cta,
    };
  }

  return {
    format: "image",
    pageId,
    ...(instagramUserId ? { instagramUserId } : {}),
    imageUrl: media.imageUrl,
    link,
    ...(input.texts?.message ? { message: input.texts.message } : {}),
    ...(input.texts?.headline ? { headline: input.texts.headline } : {}),
    cta,
  };
}

async function activateTree(args: {
  accessToken: string;
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
}): Promise<void> {
  const activate = (id: string) =>
    metaApiCall<{ success?: boolean }>({
      domain: "FACEBOOK",
      method: "POST",
      path: id,
      params: "",
      body: new URLSearchParams({ status: "ACTIVE" }),
      accessToken: args.accessToken,
    });
  for (const adId of args.adIds) await activate(adId);
  for (const adSetId of args.adSetIds) await activate(adSetId);
  await activate(args.campaignId);
}

function treeToPublish(result: CampaignTreeResult): PublishResult {
  if (!result.ok) {
    return {
      ok: false,
      issues: result.issues,
      rolledBack: result.rolledBack,
      ...(result.orphanIds?.length ? { orphanIds: result.orphanIds } : {}),
    };
  }
  return {
    ok: true,
    campaignId: result.campaignId,
    adSetIds: result.adSets.map((set) => set.id),
    adIds: result.adSets.flatMap((set) => set.ads.map((ad) => ad.id)),
  };
}

export async function publishFallbackCampaign(args: {
  adAccountId: string;
  accessToken: string;
  input: FallbackPublishInput;
}): Promise<PublishResult> {
  const { adAccountId, accessToken, input } = args;
  const resolved = resolveFallbackConfig(input.niche, input.objective);
  if ("error" in resolved) {
    return {
      ok: false,
      issues: [
        localIssue(
          "campaign",
          "FALLBACK_UNSUPPORTED",
          resolved.error,
          "Escolha outro nicho ou objetivo.",
          ["niche", "objective"],
        ),
      ],
      rolledBack: false,
    };
  }

  let instagramProfileUrl: string | undefined;
  let instagramUserId = input.instagramUserId ?? undefined;
  if (input.pageId) {
    const connected = await getConnectedPageById(accessToken, input.pageId);
    if (connected) {
      instagramUserId = instagramUserId ?? connected.instagramBusinessAccountId;
      instagramProfileUrl = connected.instagramUsername
        ? `https://www.instagram.com/${connected.instagramUsername}`
        : "https://www.instagram.com";
    }
  }

  const resolvedInput = { ...input, instagramUserId };
  const issues = fallbackIssues(resolvedInput, resolved);
  if (issues.length) {
    return { ok: false, issues, rolledBack: false };
  }

  const campaignName = buildConventionalCampaignName(
    resolved.metaObjective,
    input.niche,
  );
  const flight = resolveFlight(input, resolved, new Date());
  const geoLocations =
    buildGeoLocationsPayload(input.locations) ?? { countries: ["BR"] };

  const usesDayparting =
    resolved.acceptsDeliverySchedule &&
    input.deliveryMode === "specific_hours" &&
    (input.scheduleBlocks?.length ?? 0) > 0;

  const placementFields = resolvePlacementFields(input, resolved);

  let leadFormId: string | undefined;
  if (resolved.metaObjective === "OUTCOME_LEADS") {
    leadFormId = await createLeadForm({
      pageId: input.pageId,
      accessToken,
      name: `${campaignName} - Formulario`,
    });
  }

  const promotionUrl =
    input.texts?.link?.trim() || input.promotionUrl?.trim() || "";
  const conversionDomain =
    resolved.metaObjective === "OUTCOME_SALES"
      ? registrableDomain(promotionUrl)
      : undefined;

  const tree = await createCampaignTree({
    adAccountId,
    accessToken,
    campaign: {
      name: campaignName,
      objective: resolved.metaObjective,
      status: "PAUSED",
      specialAdCategories: [],
      lifetimeBudgetCents: flight.lifetimeCents,
      startTime: flight.startTime,
      stopTime: flight.endTime,
    },
    adSets: [
      {
        adSet: {
          name: buildConventionalAdSetName(campaignName),
          optimizationGoal:
            resolved.metaObjective === "OUTCOME_SALES"
              ? "OFFSITE_CONVERSIONS"
              : resolved.metaObjective === "OUTCOME_TRAFFIC"
                ? "VISIT_INSTAGRAM_PROFILE"
                : "LEAD_GENERATION",
          billingEvent: "IMPRESSIONS",
          ...(resolved.metaObjective === "OUTCOME_TRAFFIC"
            ? { destinationType: "INSTAGRAM_PROFILE" }
            : resolved.metaObjective === "OUTCOME_LEADS"
              ? { destinationType: "ON_AD" }
              : {}),
          promotedObject:
            resolved.metaObjective === "OUTCOME_SALES"
              ? { pixel_id: input.pixelId, custom_event_type: "PURCHASE" }
              : resolved.metaObjective === "OUTCOME_TRAFFIC"
                ? {
                    page_id: input.pageId,
                    instagram_profile_id: instagramUserId,
                  }
                : { page_id: input.pageId },
          startTime: flight.startTime,
          endTime: flight.endTime,
          status: "PAUSED",
          ...(usesDayparting
            ? {
                schedule: {
                  mode: "dayparting" as const,
                  blocks: input.scheduleBlocks,
                  timezoneType: "ADVERTISER" as const,
                },
              }
            : {}),
          extraFields: {
            targeting: {
              geo_locations: geoLocations,
              targeting_automation: { advantage_audience: 1 },
              ...placementFields,
            },
          },
        },
        ads: input.media.map((media, index) => ({
          name: buildConventionalAdName(campaignName, index, input.media.length),
          status: "PAUSED" as const,
          creative: creativeForFallback({
            media,
            input: { ...input, instagramUserId },
            config: resolved,
            instagramProfileUrl,
            leadFormId,
          }),
          ...(conversionDomain ? { conversionDomain } : {}),
        })),
      },
    ],
  }, { skipRemoteValidation: true });

  const published = treeToPublish(tree);
  if (!published.ok) {
    if (leadFormId) {
      await deleteMetaObject(leadFormId, accessToken).catch(() => false);
    }
    return published;
  }

  try {
    await activateTree({
      accessToken,
      campaignId: published.campaignId,
      adSetIds: published.adSetIds,
      adIds: published.adIds,
    });
  } catch {
    const deleted = await deleteMetaObject(published.campaignId, accessToken);
    if (leadFormId) {
      await deleteMetaObject(leadFormId, accessToken).catch(() => false);
    }
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
      ...(!deleted ? { orphanIds: [published.campaignId] } : {}),
    };
  }

  return published;
}
