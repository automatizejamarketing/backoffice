/**
 * Shared vocabulary for AI campaign creation (ADR 0022/0023): the user's ANSWERS (`PlanAnswers`,
 * `PlanMedia`, `PlanTexts`), the budget/flight suggestions, and the pure helpers that turn a media +
 * the mold into a creative (`creativeForMedia`) and a link into a conversion domain
 * (`registrableDomain`).
 *
 * The tree BUILDER that once lived here is gone: with a proven mold the wizard DUPLICATES the proven
 * ads (duplicate-campaign.ts + the shared engine), and the no-history niche fallback builds its own
 * tree (fallback.ts). What remains is the vocabulary both paths share.
 */
import type { AdCreativeInput } from "../creation/create-ad";
import type { PlacementAdaptation } from "@/lib/meta-business/creative-features";
import type { PlacementKey } from "@/lib/meta-business/placements";
import type { CampaignMold } from "./read-mold";

/** What the flow suggests, and the floor it advises (ADR 0022, decision 7). */
export const DEFAULT_DAILY_BUDGET = 30;
export const ADVISED_MIN_DAILY_BUDGET = 20;
/**
 * Flight (in days) the no-history niche FALLBACK gives a lifetime campaign. It intentionally mirrors
 * the duplication engine's `AI_DUPLICATE_FLIGHT_DAYS`, but stays a separate constant on purpose: this
 * module is imported client-side (fallback.ts) and MUST NOT pull the server-only engine
 * (`lib/meta-business/duplicate.ts` → insights → logger → node:async_hooks) into the browser bundle.
 */
export const DEFAULT_FLIGHT_DAYS = 7;

export type PlanMedia =
  | { kind: "instagram_post"; instagramMediaId: string }
  | { kind: "image"; imageUrl: string }
  /**
   * A video that is ALREADY on Meta and ALREADY processed. It never travels as a blob URL: the
   * upload and Meta's processing happen while the user answers the rest of the flow, so that
   * approving creates the whole tree in one pass (ADR 0022, decision 10). Handing `createAd` a raw
   * `videoUrl` would make it upload AND block on processing INSIDE the tree creation — minutes of
   * hanging, and a timeout would leave a half-built campaign.
   */
  | { kind: "video"; videoId: string; thumbnailUrl?: string };

export type PlanTexts = {
  headline: string;
  message: string;
  ctaType?: string;
  link?: string;
};

export type PlanAnswers = {
  /** Account currency, MAJOR units — always "per day", whatever the mold's mode. */
  dailyBudget: number;
  /** One ad set per media (ticket 03 sends exactly one; ticket 05 opens it up). */
  medias: PlanMedia[];
  /** Required for image ads; ignored for an Instagram boost (the post IS the creative). */
  texts?: PlanTexts;
  /** companies.niche — only shapes the campaign name. */
  niche?: string | null;
  /** Review-screen overrides. Absent = keep what the mold proved. */
  pageId?: string;
  instagramUserId?: string;
  pixelId?: string;
  /**
   * Proven ads the user chose to duplicate (ADR 0023). Absent = all proven ads in the campaign.
   * Unchecked ads are omitted — they are NOT copied, paused or otherwise.
   */
  keepAdIds?: string[];
  /**
   * Delivery hours override from the AI review. Absent = keep the mold schedule (mold path)
   * or all-day (fallback path).
   */
  deliveryMode?: "all_day" | "specific_hours";
  scheduleBlocks?: Array<{
    days: number[];
    startMinute: number;
    endMinute: number;
  }>;
  /**
   * Placement override from the AI review. Absent = keep the mold's targeting
   * (Advantage+ when the source omitted publisher_platforms / *_positions).
   * `manual` sends those fields and turns Advantage+ placements off (v25.0).
   */
  placementsMode?: "automatic" | "manual";
  selectedPlacements?: PlacementKey[];
  /**
   * Como o Meta pode reenquadrar a mídia nos posicionamentos onde ela não cabe
   * (o quadrado servido em Stories/Reels, o vertical servido no Feed).
   *
   * Ausente no POST da campanha com IA = AI_PLACEMENT_ADAPTATION: reenquadra
   * e pede expansão (`image_uncrop` / `video_uncrop`) para o criativo único
   * caber em Feed + Stories + Reels sem o crop 1:1 do Feed.
   */
  placementAdaptation?: PlacementAdaptation;
};

/**
 * How many medias one campaign may carry. Mirrors the wizard's MAX_MEDIA_ITEMS — but it lives HERE
 * too, because the browser is not a validator: a hand-made request with 50 medias would otherwise
 * build 50 ad sets and 150+ writes against the account's Meta error budget.
 */
export const MAX_MEDIAS = 5;

/** An Instagram boost carries its own caption — asking for a title/caption would be nonsense. */
export function needsTexts(medias: PlanMedia[]): boolean {
  return medias.some((media) => media.kind !== "instagram_post");
}

/**
 * Two-level public suffixes we actually meet. Brazil is the product's market and `.com.br` is the
 * norm — naive "last two labels" would declare conversions on `com.br` and Meta would reject it.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  "com.br",
  "net.br",
  "org.br",
  "app.br",
  "co.uk",
  "com.au",
  "com.pt",
  "com.ar",
  "com.mx",
]);

/**
 * The registrable domain (eTLD+1) of a link — what Meta wants in `conversion_domain` on an
 * offsite-conversion ad. Returns undefined for a link we cannot parse.
 */
export function registrableDomain(link?: string): string | undefined {
  if (!link?.trim()) return undefined;
  try {
    const host = new URL(link).hostname.replace(/^www\./i, "").toLowerCase();
    const labels = host.split(".");
    if (labels.length <= 2) return host;

    const lastTwo = labels.slice(-2).join(".");
    const take = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
    return labels.slice(-take).join(".");
  } catch {
    return undefined;
  }
}

export function creativeForMedia(
  media: PlanMedia,
  mold: CampaignMold,
  answers: PlanAnswers,
): AdCreativeInput {
  const pageId = answers.pageId ?? mold.identity.pageId ?? "";
  const instagramUserId = answers.instagramUserId ?? mold.identity.instagramUserId;

  if (media.kind === "instagram_post") {
    return {
      format: "instagram_post",
      instagramMediaId: media.instagramMediaId,
      pageId,
      instagramUserId: instagramUserId ?? "",
      ...(mold.destination.ctaType
        ? {
            cta: {
              type: mold.destination.ctaType,
              ...(mold.destination.link ? { link: mold.destination.link } : {}),
            },
          }
        : {}),
    };
  }

  const link = answers.texts?.link ?? mold.destination.link ?? "";
  const ctaType = answers.texts?.ctaType ?? mold.destination.ctaType ?? "LEARN_MORE";
  const cta = { type: ctaType, ...(link ? { link } : {}) };

  if (media.kind === "video") {
    return {
      format: "video",
      pageId,
      ...(instagramUserId ? { instagramUserId } : {}),
      // Already uploaded and processed — `createAd` sees a videoId and skips its own upload+wait.
      videoId: media.videoId,
      ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
      ...(answers.texts?.message ? { message: answers.texts.message } : {}),
      ...(answers.texts?.headline ? { headline: answers.texts.headline } : {}),
      // video_data has no top-level link: the destination rides on the CTA.
      cta,
    };
  }

  return {
    format: "image",
    pageId,
    ...(instagramUserId ? { instagramUserId } : {}),
    imageUrl: media.imageUrl,
    link,
    ...(answers.texts?.message ? { message: answers.texts.message } : {}),
    ...(answers.texts?.headline ? { headline: answers.texts.headline } : {}),
    cta,
  };
}
