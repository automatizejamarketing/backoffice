import { metaApiCall } from "../api";
import { GraphApiError } from "../error";
import {
  createAdCreativeFromInstagramPost,
  createDynamicAdCreative,
  createDynamicVideoAdCreative,
} from "./creative-builders";
import { uploadImageToAdAccount } from "./upload-ad-image";
import { uploadVideoToMeta } from "./upload-video-to-meta";

export type AdMediaInput =
  | { kind: "instagram"; instagramMediaId: string }
  | { kind: "automatize_image"; imageUrl: string }
  | { kind: "device_image"; blobUrl: string }
  | { kind: "device_video"; blobUrl: string };

/**
 * Instagram posts preserve their own caption (built via
 * `source_instagram_media_id`), so `titles`/`texts` are ignored for them.
 * Image/video creatives use Dynamic Creative with 1-5 titles and 1-5 texts
 * (mirrors automatize-frontend's campaign creation).
 */
export type AdCreativeText = {
  titles: string[];
  texts: string[];
  ctaType?: string;
  linkUrl: string;
};

const MAX_TITLES = 5;
const MAX_TEXTS = 5;

function validateDynamicText(titles: string[], texts: string[]): void {
  const t = titles.map((s) => s.trim()).filter(Boolean);
  const b = texts.map((s) => s.trim()).filter(Boolean);
  const fail = (message: string) => {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Texto do anúncio inválido",
        message,
        solution: "Informe entre 1 e 5 títulos e entre 1 e 5 textos.",
        isTransient: false,
      },
    });
  };
  if (t.length < 1) fail("Informe ao menos um título.");
  if (t.length > MAX_TITLES) fail(`No máximo ${MAX_TITLES} títulos.`);
  if (b.length < 1) fail("Informe ao menos um texto principal.");
  if (b.length > MAX_TEXTS) fail(`No máximo ${MAX_TEXTS} textos principais.`);
}

export type ResolvedPage = {
  pageId: string;
  igAccountId: string;
  igUsername?: string;
};

/**
 * `creative_ready`  → a creative exists, the caller may create/repoint the ad.
 * `video_processing`→ a device video was uploaded to Meta but is still
 *                      processing; the caller must poll status and re-invoke
 *                      with `confirmedVideo` once ready.
 */
export type BuildCreativeOutcome =
  | {
      phase: "creative_ready";
      creativeId: string;
      mediaKind: "image" | "video" | "instagram_post";
      videoId?: string;
      blobUrlsForCleanup: string[];
    }
  | {
      phase: "video_processing";
      videoId: string;
      thumbnailUrl: string;
      blobUrlsForCleanup: string[];
    };

type GraphApiPagesResponse = {
  data: Array<{
    id: string;
    name?: string;
    instagram_business_account?: { id: string; username?: string };
  }>;
};

/**
 * Resolve the Facebook Page + connected Instagram business account used as
 * the `object_story_spec` actor. Mirrors the resolution in
 * `app/api/meta-marketing/[accountId]/adsets/route.ts`.
 */
export async function resolvePageAndIg(
  accessToken: string,
  /** Ad set's promoted_object.page_id — the creative identity MUST match it. */
  preferredPageId?: string,
): Promise<ResolvedPage> {
  const pagesResponse = await metaApiCall<GraphApiPagesResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: "me/accounts",
    params: "fields=id,name,instagram_business_account{id,username}",
    accessToken,
  });

  console.log("TODELETE - [resolvePageAndIg] me/accounts response", {
    preferredPageId,
    pageCount: pagesResponse.data?.length ?? 0,
    pages: pagesResponse.data?.map((p) => ({
      id: p.id,
      name: p.name,
      igId: p.instagram_business_account?.id,
      igUsername: p.instagram_business_account?.username,
    })),
  });

  // Prefer the page the ad set actually promotes (so object_story_spec matches
  // the ad set's promoted_object); fall back to the first page with an IG.
  const preferredPage = preferredPageId
    ? pagesResponse.data.find(
        (p) => p.id === preferredPageId && p.instagram_business_account?.id,
      )
    : undefined;
  const pageWithIg =
    preferredPage ??
    pagesResponse.data.find((p) => p.instagram_business_account?.id);

  console.log("TODELETE - [resolvePageAndIg] chosen page", {
    matchedPreferred: Boolean(preferredPage),
    pageId: pageWithIg?.id,
    igAccountId: pageWithIg?.instagram_business_account?.id,
    igUsername: pageWithIg?.instagram_business_account?.username,
  });

  if (!pageWithIg?.instagram_business_account?.id) {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Nenhuma Página com Instagram conectado",
        message:
          "Nenhuma Página do Facebook com conta do Instagram conectada foi encontrada para esta conta Meta. É necessária para criar o criativo do anúncio.",
        solution:
          "Conecte uma Página do Facebook com uma conta Instagram Business à conta Meta do usuário e tente novamente.",
        isTransient: false,
      },
    });
  }

  return {
    pageId: pageWithIg.id,
    igAccountId: pageWithIg.instagram_business_account.id,
    igUsername: pageWithIg.instagram_business_account.username,
  };
}

/**
 * Single orchestration used by BOTH the create-ad and edit-creative routes.
 *
 * Image/Instagram media produce a creative synchronously. Device video is a
 * two-phase flow: the first call uploads the video to Meta and returns
 * `video_processing`; once the caller confirms the video is `ready` it
 * re-invokes with `confirmedVideo` to build the video creative.
 */
export async function buildCreativeFromMedia(args: {
  adAccountId: string;
  accessToken: string;
  name: string;
  media: AdMediaInput;
  text: AdCreativeText;
  page: ResolvedPage;
  /** Target ad set's is_dynamic_creative — the creative MUST match it. */
  adSetIsDynamic: boolean;
  /** Ad set's destination_type / optimization_goal — shapes CTA + link. */
  adSetDestinationType?: string;
  adSetOptimizationGoal?: string;
  confirmedVideo?: { videoId: string; thumbnailUrl: string };
}): Promise<BuildCreativeOutcome> {
  const {
    adAccountId,
    accessToken,
    name,
    media,
    text,
    page,
    adSetIsDynamic,
    adSetDestinationType,
    adSetOptimizationGoal,
  } = args;

  // Traffic → Instagram profile ad sets force the destination to the IG
  // profile. The creative MUST use LEARN_MORE + the profile URL; the form's
  // website/CTA do not apply (Meta rejects the bind otherwise — subcode
  // 1346001). Mirrors automatize-frontend's create-traffic-campaign.ts.
  const isInstagramProfileDestination =
    adSetDestinationType === "INSTAGRAM_PROFILE" ||
    adSetOptimizationGoal === "VISIT_INSTAGRAM_PROFILE" ||
    adSetOptimizationGoal === "PROFILE_VISIT";

  if (isInstagramProfileDestination && !page.igUsername) {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Perfil do Instagram indisponível",
        message:
          "Este conjunto direciona para o perfil do Instagram, mas não foi possível obter o usuário do Instagram da Página conectada.",
        solution:
          "Verifique a conta do Instagram conectada à Página do Facebook e tente novamente.",
        isTransient: false,
      },
    });
  }

  const effectiveCtaType = isInstagramProfileDestination
    ? "LEARN_MORE"
    : text.ctaType;
  const effectiveUrl = isInstagramProfileDestination
    ? `https://www.instagram.com/${page.igUsername}`
    : text.linkUrl;

  console.log("TODELETE - [buildCreativeFromMedia] entry", {
    adAccountId,
    name,
    mediaKind: media.kind,
    adSetIsDynamic,
    adSetDestinationType,
    adSetOptimizationGoal,
    isInstagramProfileDestination,
    page,
    formLinkUrl: text.linkUrl,
    formCtaType: text.ctaType,
    effectiveUrl,
    effectiveCtaType,
    titles: text.titles,
    texts: text.texts,
    hasConfirmedVideo: Boolean(args.confirmedVideo),
    confirmedVideo: args.confirmedVideo,
  });

  const common = {
    adAccountId,
    accessToken,
    name,
    pageId: page.pageId,
    instagramAccountId: page.igAccountId,
    url: effectiveUrl,
    ctaType: effectiveCtaType,
  };

  // Instagram = boost an existing post (source_instagram_media_id), a
  // non-dynamic creative. Meta forbids it in a Dynamic Creative ad set and
  // there is no way to express an existing IG post as asset_feed_spec.
  if (media.kind === "instagram") {
    if (adSetIsDynamic) {
      throw new GraphApiError({
        statusCode: 400,
        reason: {
          httpStatusCode: 400,
          title: "Instagram não suportado em Criativo Dinâmico",
          message:
            "Este conjunto de anúncios usa Criativo Dinâmico; publicações do Instagram não podem ser usadas aqui.",
          solution:
            "Selecione uma imagem/vídeo, ou use um conjunto de anúncios que não seja de Criativo Dinâmico.",
          isTransient: false,
        },
      });
    }
    const creative = await createAdCreativeFromInstagramPost({
      ...common,
      instagramMediaId: media.instagramMediaId,
    });
    return {
      phase: "creative_ready",
      creativeId: creative.id,
      mediaKind: "instagram_post",
      blobUrlsForCleanup: [],
    };
  }

  // Automatize / device media always use Dynamic Creative (asset_feed_spec).
  // The ad set's is_dynamic_creative is fixed at creation and cannot be
  // toggled, so a non-dynamic ad set is incompatible — surface a clear,
  // actionable error BEFORE uploading anything to Meta.
  if (!adSetIsDynamic) {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Conjunto de anúncios não é de Criativo Dinâmico",
        message:
          "Mídias do Automatize e do dispositivo usam Criativo Dinâmico, mas este conjunto de anúncios não é de Criativo Dinâmico.",
        solution:
          "Selecione uma publicação do Instagram, ou use um conjunto de anúncios de Criativo Dinâmico.",
        isTransient: false,
      },
    });
  }

  // 1-5 titles + 1-5 texts for the Dynamic Creative asset_feed_spec.
  validateDynamicText(text.titles, text.texts);
  const titles = text.titles.map((s) => s.trim()).filter(Boolean);
  const texts = text.texts.map((s) => s.trim()).filter(Boolean);

  if (media.kind === "automatize_image" || media.kind === "device_image") {
    const imageUrl =
      media.kind === "automatize_image" ? media.imageUrl : media.blobUrl;
    console.log("TODELETE - [buildCreativeFromMedia] image branch", {
      mediaKind: media.kind,
      imageUrl,
      titles,
      texts,
    });
    const creative = await createDynamicAdCreative({
      ...common,
      imageUrl,
      titles,
      texts,
    });
    console.log("TODELETE - [buildCreativeFromMedia] image creative created", {
      creativeId: creative.id,
    });
    return {
      phase: "creative_ready",
      creativeId: creative.id,
      mediaKind: "image",
      blobUrlsForCleanup:
        media.kind === "device_image" ? [media.blobUrl] : [],
    };
  }

  // device_video — two-phase.
  if (!args.confirmedVideo) {
    const { id: videoId, thumbnailUrl } = await uploadVideoToMeta({
      adAccountId,
      accessToken,
      videoUrl: media.blobUrl,
      title: name,
    });
    return {
      phase: "video_processing",
      videoId,
      thumbnailUrl,
      blobUrlsForCleanup: [media.blobUrl],
    };
  }

  console.log("TODELETE - [buildCreativeFromMedia] video branch", {
    videoId: args.confirmedVideo.videoId,
    thumbnailUrl: args.confirmedVideo.thumbnailUrl,
    titles,
    texts,
  });
  const creative = await createDynamicVideoAdCreative({
    ...common,
    videoId: args.confirmedVideo.videoId,
    thumbnailUrl: args.confirmedVideo.thumbnailUrl,
    titles,
    texts,
  });
  console.log("TODELETE - [buildCreativeFromMedia] video creative created", {
    creativeId: creative.id,
  });
  return {
    phase: "creative_ready",
    creativeId: creative.id,
    mediaKind: "video",
    videoId: args.confirmedVideo.videoId,
    blobUrlsForCleanup: [media.blobUrl],
  };
}

/**
 * Unused-image guard: the `uploadImageToAdAccount` re-upload helper is the
 * only sanctioned path for turning a Blob/CDN URL into a Meta image — never
 * pass a raw URL as `picture`. Re-exported so routes can pre-validate.
 */
export { uploadImageToAdAccount };
