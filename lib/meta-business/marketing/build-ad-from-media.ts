import { metaApiCall } from "../api";
import { GraphApiError } from "../error";
import {
  createAdCreative,
  createAdCreativeFromInstagramPost,
  createDynamicAdCreative,
  createDynamicVideoAdCreative,
  createVideoAdCreative,
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
 *
 * For image/video creatives, the validation is bifurcated by
 * `adSetIsDynamic` at the call site:
 * - non-dynamic ad sets (new flow): exactly 1 title + 1 text — sent to
 *   Meta via object_story_spec.link_data / .video_data.
 * - dynamic ad sets (legacy — `is_dynamic_creative=true` cannot be
 *   undone): 1–5 titles and 1–5 texts — sent to Meta via asset_feed_spec.
 *
 * The shape of `AdCreativeText` is kept as arrays so the request payload
 * stays consistent across both modes; the single-text mode just sends
 * arrays with one entry.
 */
export type AdCreativeText = {
  titles: string[];
  texts: string[];
  ctaType?: string;
  linkUrl: string;
};

const MAX_TITLES = 5;
const MAX_TEXTS = 5;

function validateAdText(
  titles: string[],
  texts: string[],
  adSetIsDynamic: boolean,
): void {
  const t = titles.map((s) => s.trim()).filter(Boolean);
  const b = texts.map((s) => s.trim()).filter(Boolean);
  const fail = (message: string, solution: string) => {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Texto do anúncio inválido",
        message,
        solution,
        isTransient: false,
      },
    });
  };
  if (adSetIsDynamic) {
    if (t.length < 1)
      fail(
        "Informe ao menos um título.",
        "Informe entre 1 e 5 títulos e entre 1 e 5 textos.",
      );
    if (t.length > MAX_TITLES)
      fail(
        `No máximo ${MAX_TITLES} títulos.`,
        "Informe entre 1 e 5 títulos e entre 1 e 5 textos.",
      );
    if (b.length < 1)
      fail(
        "Informe ao menos um texto principal.",
        "Informe entre 1 e 5 títulos e entre 1 e 5 textos.",
      );
    if (b.length > MAX_TEXTS)
      fail(
        `No máximo ${MAX_TEXTS} textos principais.`,
        "Informe entre 1 e 5 títulos e entre 1 e 5 textos.",
      );
  } else {
    if (t.length !== 1)
      fail(
        "Informe exatamente um título.",
        "Anúncios de criativo não dinâmico aceitam 1 título e 1 texto principal.",
      );
    if (b.length !== 1)
      fail(
        "Informe exatamente um texto principal.",
        "Anúncios de criativo não dinâmico aceitam 1 título e 1 texto principal.",
      );
  }
}

export type ResolvedPage = {
  pageId: string;
  igAccountId: string;
  igUsername?: string;
};

/**
 * A Facebook Page (with its connected Instagram account) the admin can choose
 * as the ad identity. Only pages with a connected Instagram account are
 * returned, mirroring `automatize-frontend`'s page selector.
 */
export type PageIdentity = {
  pageId: string;
  pageName?: string;
  pagePictureUrl?: string;
  instagramBusinessAccountId: string;
  instagramUsername?: string;
  instagramProfilePictureUrl?: string;
};

type GraphApiPagesWithPicturesResponse = {
  data: Array<{
    id: string;
    name?: string;
    picture?: { data?: { url?: string } };
    instagram_business_account?: {
      id: string;
      username?: string;
      profile_picture_url?: string;
    };
  }>;
};

/**
 * List the Facebook Pages (with a connected Instagram account) available to the
 * user's Meta token. Used to let a backoffice admin pick the ad identity.
 */
export async function getPagesWithInstagram(
  accessToken: string,
): Promise<PageIdentity[]> {
  const pagesResponse = await metaApiCall<GraphApiPagesWithPicturesResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: "me/accounts",
    params:
      "fields=id,name,picture,instagram_business_account{id,username,profile_picture_url}",
    accessToken,
  });

  return pagesResponse.data
    .filter((page) => page.instagram_business_account?.id)
    .map((page) => ({
      pageId: page.id,
      pageName: page.name,
      pagePictureUrl: page.picture?.data?.url,
      instagramBusinessAccountId: page.instagram_business_account!.id,
      instagramUsername: page.instagram_business_account!.username,
      instagramProfilePictureUrl:
        page.instagram_business_account!.profile_picture_url,
    }));
}

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
  // there is no way to express an existing IG post as asset_feed_spec, so
  // legacy dynamic ad sets keep refusing Instagram media.
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

  // Automatize / device media: bifurcate by the ad set's is_dynamic_creative
  // (fixed at creation, cannot be toggled afterwards).
  //   - legacy dynamic ad sets → asset_feed_spec with 1-5 titles + 1-5 texts.
  //   - new non-dynamic ad sets → object_story_spec.link_data/.video_data
  //     with exactly 1 title and 1 text.
  validateAdText(text.titles, text.texts, adSetIsDynamic);
  const titles = text.titles.map((s) => s.trim()).filter(Boolean);
  const texts = text.texts.map((s) => s.trim()).filter(Boolean);

  if (media.kind === "automatize_image" || media.kind === "device_image") {
    const imageUrl =
      media.kind === "automatize_image" ? media.imageUrl : media.blobUrl;
    const creative = adSetIsDynamic
      ? await createDynamicAdCreative({
          ...common,
          imageUrl,
          titles,
          texts,
        })
      : await createAdCreative({
          ...common,
          imageUrl,
          headline: titles[0],
          bodyText: texts[0],
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

  const creative = adSetIsDynamic
    ? await createDynamicVideoAdCreative({
        ...common,
        videoId: args.confirmedVideo.videoId,
        thumbnailUrl: args.confirmedVideo.thumbnailUrl,
        titles,
        texts,
      })
    : await createVideoAdCreative({
        ...common,
        videoId: args.confirmedVideo.videoId,
        thumbnailUrl: args.confirmedVideo.thumbnailUrl,
        headline: titles[0],
        bodyText: texts[0],
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
