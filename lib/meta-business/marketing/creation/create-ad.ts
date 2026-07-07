/**
 * createAd — unified Meta ad (+ creative) creation primitive (ADR 0009).
 *
 * Builds the creative (image / video / carousel / existing post / IG boost, or an
 * existing creative_id), then the ad. Same guarded flow: local validation → Meta
 * `validate_only` (on the creative — the risky part) → real create. Returns a
 * {@link CreateResult}. Asset URLs are uploaded via the existing helpers to get
 * image_hash / video_id (image_hash avoids Meta's "couldn't download" error).
 *
 * Endpoints: POST /act_{id}/adcreatives then POST /act_{id}/ads.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { uploadImageToAdAccount } from "../upload-ad-image";
import { uploadAdVideoFromUrl, waitForVideoReady } from "../upload-ad-video";
import {
  type CreateIssue,
  type CreateResult,
  type PreviewResult,
  fail,
  localIssue,
  mergeExtraFields,
  ok,
} from "./types";
import { issuesFromError } from "./normalize";
import { collect, subcodeSuggestion, validateCarouselCards } from "./validation";
import { deleteMetaObject } from "./delete";

/** Disable multi-advertiser ads (don't show alongside other advertisers'). */
const OPT_OUT_MULTI_ADS = JSON.stringify({ enroll_status: "OPT_OUT" });

export type AdCta = {
  /** e.g. SHOP_NOW, LEARN_MORE, SIGN_UP, WHATSAPP_MESSAGE, MESSAGE_PAGE. */
  type: string;
  link?: string;
  /** Lead form id (lead ads) → call_to_action.value.lead_gen_form_id. */
  leadGenFormId?: string;
  /** WHATSAPP | MESSENGER for click-to-message. */
  appDestination?: string;
};

export type CarouselCardInput = {
  imageHash?: string;
  imageUrl?: string;
  link?: string;
  name?: string;
  description?: string;
  cta?: AdCta;
};

export type AdCreativeInput =
  | { format: "creative_id"; creativeId: string }
  | { format: "existing_post"; objectStoryId: string; cta?: AdCta }
  | {
      format: "instagram_post";
      instagramMediaId: string;
      pageId: string;
      instagramUserId: string;
      cta?: AdCta;
    }
  | {
      format: "image";
      pageId: string;
      instagramUserId?: string;
      imageHash?: string;
      imageUrl?: string;
      link: string;
      message?: string;
      headline?: string;
      description?: string;
      cta: AdCta;
    }
  | {
      format: "video";
      pageId: string;
      instagramUserId?: string;
      videoId?: string;
      videoUrl?: string;
      thumbnailHash?: string;
      thumbnailUrl?: string;
      message?: string;
      headline?: string;
      /** Destination link lives in cta.link (video_data has no top-level link). */
      cta: AdCta;
    }
  | {
      format: "carousel";
      pageId: string;
      instagramUserId?: string;
      link?: string;
      message?: string;
      cards: CarouselCardInput[];
      cta?: AdCta;
    };

export type CreateAdInput = {
  adAccountId: string;
  accessToken: string;
  adSetId: string;
  name: string;
  creative: AdCreativeInput;
  creativeName?: string;
  /** UTM/tracking appended to destination links (Meta `url_tags`). */
  urlTags?: string;
  /** Parent optimization goal — to require conversion_domain for web conversions. */
  optimizationGoal?: string;
  /** Registrable domain where conversions happen (required for offsite-conversion ads). */
  conversionDomain?: string;
  /** Defaults to PAUSED. */
  status?: "ACTIVE" | "PAUSED";
  /** Escape hatch merged into the creative POST. */
  creativeExtraFields?: Record<string, unknown>;
  /** Escape hatch merged into the ad POST. */
  extraFields?: Record<string, unknown>;
};

// ───────────────────────── pure builders ─────────────────────────

export function buildCtaObject(cta?: AdCta): Record<string, unknown> | undefined {
  if (!cta) return undefined;
  const value: Record<string, unknown> = {};
  if (cta.link) value.link = cta.link;
  if (cta.leadGenFormId) value.lead_gen_form_id = cta.leadGenFormId;
  if (cta.appDestination) value.app_destination = cta.appDestination;
  return Object.keys(value).length
    ? { type: cta.type, value }
    : { type: cta.type };
}

/**
 * Build the Meta `object_story_spec` for the creative. Assumes assets are already
 * resolved (imageHash / videoId present) — see {@link resolveAssets}.
 */
export function buildObjectStorySpec(
  creative: AdCreativeInput,
): Record<string, unknown> {
  const c = creative;
  if (c.format === "image") {
    const linkData: Record<string, unknown> = { link: c.link, image_hash: c.imageHash };
    if (c.message) linkData.message = c.message;
    if (c.headline) linkData.name = c.headline;
    if (c.description) linkData.description = c.description;
    const cta = buildCtaObject(c.cta);
    if (cta) linkData.call_to_action = cta;
    return identity(c.pageId, c.instagramUserId, { link_data: linkData });
  }
  if (c.format === "video") {
    const videoData: Record<string, unknown> = { video_id: c.videoId };
    if (c.thumbnailHash) videoData.image_hash = c.thumbnailHash;
    else if (c.thumbnailUrl) videoData.image_url = c.thumbnailUrl;
    if (c.message) videoData.message = c.message;
    if (c.headline) videoData.title = c.headline;
    const cta = buildCtaObject(c.cta);
    if (cta) videoData.call_to_action = cta;
    return identity(c.pageId, c.instagramUserId, { video_data: videoData });
  }
  // carousel
  if (c.format === "carousel") {
    const child = c.cards.map((card) => {
      const a: Record<string, unknown> = {
        link: card.link ?? c.link,
        image_hash: card.imageHash,
      };
      if (card.name) a.name = card.name;
      if (card.description) a.description = card.description;
      const cc = buildCtaObject(card.cta ?? c.cta);
      if (cc) a.call_to_action = cc;
      return a;
    });
    const linkData: Record<string, unknown> = { child_attachments: child };
    if (c.link) linkData.link = c.link;
    if (c.message) linkData.message = c.message;
    const cta = buildCtaObject(c.cta);
    if (cta) linkData.call_to_action = cta;
    return identity(c.pageId, c.instagramUserId, { link_data: linkData });
  }
  return {};
}

function identity(
  pageId: string,
  instagramUserId: string | undefined,
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return {
    page_id: pageId,
    ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
    ...rest,
  };
}

/**
 * Build the /adcreatives POST body. Returns null for `creative_id` (no creative
 * is created — the existing one is reused).
 */
export function buildAdCreativeFields(
  input: CreateAdInput,
): URLSearchParams | null {
  const c = input.creative;
  if (c.format === "creative_id") return null;

  const p = new URLSearchParams();
  p.set("name", input.creativeName ?? input.name);

  if (c.format === "existing_post") {
    p.set("object_story_id", c.objectStoryId);
  } else if (c.format === "instagram_post") {
    p.set("source_instagram_media_id", c.instagramMediaId);
    p.set("object_id", c.pageId);
    p.set("instagram_user_id", c.instagramUserId);
    const cta = buildCtaObject(c.cta);
    if (cta) p.set("call_to_action", JSON.stringify(cta));
    p.set("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  } else {
    p.set("object_story_spec", JSON.stringify(buildObjectStorySpec(c)));
    p.set("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  }

  if (input.urlTags) p.set("url_tags", input.urlTags);
  mergeExtraFields(p, input.creativeExtraFields);
  return p;
}

const CONVERSION_GOALS = new Set(["OFFSITE_CONVERSIONS", "VALUE"]);

/** Pure local validation (collect-all). No Meta calls. */
export function validateAdInput(input: CreateAdInput): CreateIssue[] {
  const c = input.creative;
  const issues = collect(
    input.name?.trim()
      ? []
      : [localIssue("ad", "NAME_REQUIRED", "O anúncio precisa de um nome.", "Informe um name não vazio.", ["name"])],
    input.adSetId?.trim()
      ? []
      : [localIssue("ad", "ADSET_ID_REQUIRED", "O anúncio precisa do adset_id pai.", "Crie o conjunto primeiro e passe o id retornado.", ["adset_id"])],
  );

  // conversion_domain required for offsite-conversion ads.
  if (
    input.optimizationGoal &&
    CONVERSION_GOALS.has(input.optimizationGoal) &&
    !input.conversionDomain
  ) {
    issues.push(
      localIssue(
        "ad",
        "CONVERSION_DOMAIN_REQUIRED",
        "Anúncios otimizados para conversões no site exigem conversion_domain.",
        "Informe conversion_domain (o domínio eTLD+1, ex.: minhaloja.com) verificado no Gerenciador.",
        ["conversion_domain"],
      ),
    );
  }

  // Format-specific required fields + SEND_MESSAGE guard.
  const ctaIssues = (cta?: AdCta): CreateIssue[] =>
    cta?.type === "SEND_MESSAGE"
      ? [
          localIssue(
            "creative",
            "CTA_SEND_MESSAGE_INVALID",
            "SEND_MESSAGE não existe no enum de call_to_action.",
            "Use MESSAGE_PAGE (Messenger) ou WHATSAPP_MESSAGE (WhatsApp).",
            ["call_to_action", "type"],
          ),
        ]
      : [];

  switch (c.format) {
    case "creative_id":
      if (!c.creativeId?.trim())
        issues.push(localIssue("creative", "CREATIVE_ID_REQUIRED", "creativeId é obrigatório.", "Informe um creative_id válido.", ["creative"]));
      break;
    case "existing_post":
      if (!c.objectStoryId?.trim())
        issues.push(localIssue("creative", "OBJECT_STORY_ID_REQUIRED", "objectStoryId é obrigatório (formato <PAGE>_<POST>).", "Informe o id da publicação existente.", ["object_story_id"]));
      issues.push(...ctaIssues(c.cta));
      break;
    case "instagram_post":
      if (!c.instagramMediaId?.trim() || !c.pageId?.trim() || !c.instagramUserId?.trim())
        issues.push(localIssue("creative", "IG_POST_FIELDS_REQUIRED", "Boost de post IG exige instagramMediaId, pageId e instagramUserId.", "Informe os três campos.", ["source_instagram_media_id"]));
      issues.push(...ctaIssues(c.cta));
      break;
    case "image":
      if (!c.imageHash && !c.imageUrl)
        issues.push(localIssue("creative", "IMAGE_REQUIRED", "Anúncio de imagem exige imageHash ou imageUrl.", "Forneça image_hash (preferível) ou uma imageUrl para upload.", ["image_hash"]));
      if (!c.link?.trim())
        issues.push(localIssue("creative", "LINK_REQUIRED", "Anúncio de imagem exige link de destino.", "Informe a URL de destino (link).", ["link"]));
      if (!c.cta?.type)
        issues.push(localIssue("creative", "CTA_REQUIRED", "Anúncio de imagem exige um call_to_action.", "Informe cta.type (ex.: LEARN_MORE, SHOP_NOW).", ["call_to_action"]));
      issues.push(...ctaIssues(c.cta));
      break;
    case "video":
      if (!c.videoId && !c.videoUrl)
        issues.push(localIssue("creative", "VIDEO_REQUIRED", "Anúncio de vídeo exige videoId ou videoUrl.", "Forneça video_id (preferível) ou uma videoUrl para upload.", ["video_id"]));
      if (!c.cta?.type)
        issues.push(localIssue("creative", "CTA_REQUIRED", "Anúncio de vídeo exige um call_to_action (o link de destino vai em cta.link).", "Informe cta.type e, normalmente, cta.link.", ["call_to_action"]));
      issues.push(...ctaIssues(c.cta));
      break;
    case "carousel":
      issues.push(...validateCarouselCards(c.cards?.length ?? 0));
      (c.cards ?? []).forEach((card, i) => {
        if (!card.imageHash && !card.imageUrl)
          issues.push(localIssue("creative", "CAROUSEL_CARD_IMAGE_REQUIRED", `Cartão ${i} do carrossel precisa de imageHash ou imageUrl.`, "Cada cartão precisa de uma imagem (image_hash ou imageUrl).", ["child_attachments", String(i)]));
      });
      issues.push(...ctaIssues(c.cta));
      break;
  }

  return issues;
}

// ───────────────────────── async flow ─────────────────────────

function formatAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

function withValidateOnly(body: URLSearchParams): URLSearchParams {
  const v = new URLSearchParams(body);
  v.set("execution_options", JSON.stringify(["validate_only"]));
  return v;
}

/** Upload any imageUrl/videoUrl assets and return a creative with refs filled. */
async function resolveAssets(
  account: string,
  accessToken: string,
  creative: AdCreativeInput,
): Promise<AdCreativeInput> {
  if (creative.format === "image" && !creative.imageHash && creative.imageUrl) {
    const { hash } = await uploadImageToAdAccount({ adAccountId: account, accessToken, imageUrl: creative.imageUrl });
    return { ...creative, imageHash: hash };
  }
  if (creative.format === "video" && !creative.videoId && creative.videoUrl) {
    const { id } = await uploadAdVideoFromUrl(account, accessToken, creative.videoUrl);
    await waitForVideoReady(id, accessToken);
    return { ...creative, videoId: id };
  }
  if (creative.format === "carousel") {
    const cards = await Promise.all(
      creative.cards.map(async (card) =>
        !card.imageHash && card.imageUrl
          ? { ...card, imageHash: (await uploadImageToAdAccount({ adAccountId: account, accessToken, imageUrl: card.imageUrl })).hash }
          : card,
      ),
    );
    return { ...creative, cards };
  }
  return creative;
}

/**
 * Build (resolve assets → validate_only → create) a single AdCreative from a
 * {@link CreateAdInput}'s `creative`, returning the new creative id or issues.
 * Exported so the UPDATE primitives (ADR 0010) can rebuild a creative and
 * repoint an ad without duplicating the asset-upload + validate flow.
 */
export async function createCreative(
  account: string,
  accessToken: string,
  input: CreateAdInput,
  skipRemoteValidation: boolean,
): Promise<{ id: string } | { issues: CreateIssue[] }> {
  let resolved: AdCreativeInput;
  try {
    resolved = await resolveAssets(account, accessToken, input.creative);
  } catch (error) {
    return { issues: issuesFromError(error, "create", "creative", subcodeSuggestion) };
  }

  const fields = buildAdCreativeFields({ ...input, creative: resolved });
  if (!fields) return { issues: [] }; // creative_id path — unreachable here

  if (!skipRemoteValidation) {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: `${account}/adcreatives`,
        params: "",
        body: withValidateOnly(fields),
        accessToken,
      });
    } catch (error) {
      return { issues: issuesFromError(error, "validate_only", "creative", subcodeSuggestion) };
    }
  }

  try {
    const res = await metaApiCall<{ id: string }>({
      method: "POST",
      path: `${account}/adcreatives`,
      params: "",
      body: fields,
      accessToken,
    });
    return { id: res.id };
  } catch (error) {
    return { issues: issuesFromError(error, "create", "creative", subcodeSuggestion) };
  }
}

function buildAdPayload(input: CreateAdInput, creativeId: string): URLSearchParams {
  const p = new URLSearchParams();
  p.set("name", input.name.trim());
  p.set("adset_id", input.adSetId);
  p.set("creative", JSON.stringify({ creative_id: creativeId }));
  p.set("status", input.status ?? "PAUSED");
  if (input.conversionDomain) p.set("conversion_domain", input.conversionDomain);
  mergeExtraFields(p, input.extraFields);
  return p;
}

/**
 * Preview (no write): local validation + Meta `validate_only` on the creative (or
 * the ad, when reusing a creative_id). The AI assistant's confirm step.
 */
export async function previewAd(input: CreateAdInput): Promise<PreviewResult> {
  const localIssues = validateAdInput(input);
  if (localIssues.length) return { ok: false, issues: localIssues };

  const account = formatAccountId(input.adAccountId);

  if (input.creative.format === "creative_id") {
    const adBody = buildAdPayload(input, input.creative.creativeId);
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: `${account}/ads`,
        params: "",
        body: withValidateOnly(adBody),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return { ok: false, issues: issuesFromError(error, "validate_only", "ad", subcodeSuggestion) };
    }
    return { ok: true, payload: Object.fromEntries(adBody) as Record<string, string> };
  }

  // For a new creative, validate the creative spec (the risky part). Asset URLs
  // are NOT uploaded in preview — only image_hash/video_id already present can be
  // validated; otherwise we report the spec without a remote check.
  const fields = buildAdCreativeFields(input);
  if (!fields) return { ok: false, issues: localIssues };
  const ready = !specNeedsUpload(input.creative);
  if (ready) {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: `${account}/adcreatives`,
        params: "",
        body: withValidateOnly(fields),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return { ok: false, issues: issuesFromError(error, "validate_only", "creative", subcodeSuggestion) };
    }
  }
  return { ok: true, payload: Object.fromEntries(fields) as Record<string, string> };
}

function specNeedsUpload(c: AdCreativeInput): boolean {
  if (c.format === "image") return !c.imageHash && !!c.imageUrl;
  if (c.format === "video") return !c.videoId && !!c.videoUrl;
  if (c.format === "carousel") return c.cards.some((card) => !card.imageHash && !!card.imageUrl);
  return false;
}

export async function createAd(
  input: CreateAdInput,
  opts: { skipRemoteValidation?: boolean } = {},
): Promise<CreateResult<{ id: string; creativeId: string }>> {
  const localIssues = validateAdInput(input);
  if (localIssues.length) return fail(localIssues);

  const account = formatAccountId(input.adAccountId);

  let creativeId: string;
  if (input.creative.format === "creative_id") {
    creativeId = input.creative.creativeId;
  } else {
    const created = await createCreative(
      account,
      input.accessToken,
      input,
      Boolean(opts.skipRemoteValidation),
    );
    if ("issues" in created) return fail(created.issues);
    creativeId = created.id;
  }

  const adBody = buildAdPayload(input, creativeId);
  try {
    const res = await metaApiCall<{ id: string }>({
      method: "POST",
      path: `${account}/ads`,
      params: "",
      body: adBody,
      accessToken: input.accessToken,
    });
    return ok(res.id, { id: res.id, creativeId });
  } catch (error) {
    // Self-rollback: if we just created the creative, delete it so a failed ad
    // never leaves an orphan creative behind (keeps createAd atomic).
    if (input.creative.format !== "creative_id") {
      await deleteMetaObject(creativeId, input.accessToken);
    }
    return fail(issuesFromError(error, "create", "ad", subcodeSuggestion));
  }
}
