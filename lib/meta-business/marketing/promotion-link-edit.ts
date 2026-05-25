import { metaApiCall } from "@/lib/meta-business/api";
import { duplicateAd } from "@/lib/meta-business/duplicate";
import { GraphApiError } from "@/lib/meta-business/error";

type GraphCallToAction = {
  type?: string;
  value?: {
    link?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type GraphCreative = {
  id: string;
  name?: string;
  object_id?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  instagram_user_id?: string;
  source_instagram_media_id?: string;
  call_to_action?: GraphCallToAction;
  url_tags?: string;
  object_story_spec?: {
    page_id?: string;
    instagram_user_id?: string;
    link_data?: {
      link?: string;
      call_to_action?: GraphCallToAction;
      [key: string]: unknown;
    };
    video_data?: {
      call_to_action?: GraphCallToAction;
      [key: string]: unknown;
    };
    template_data?: {
      link?: string;
      call_to_action?: GraphCallToAction;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  asset_feed_spec?: {
    link_urls?: Array<{
      website_url?: string;
      [key: string]: unknown;
    }>;
    images?: unknown[];
    videos?: unknown[];
    [key: string]: unknown;
  };
};

type GraphAd = {
  id: string;
  name?: string;
  adset_id?: string;
  campaign_id?: string;
  creative?: { id?: string };
  campaign?: { id?: string; objective?: string };
};

type CreateCreativeResponse = {
  id: string;
};

type GraphPagesWithInstagramResponse = {
  data?: Array<{
    id: string;
    instagram_business_account?: { id?: string };
  }>;
};

export type PromotionLinkDetails = {
  adId: string;
  creativeId: string;
  campaignObjective?: string;
  promotionUrl?: string;
  ctaType?: string;
};

export type PromotionLinkUpdateResult = {
  strategy: "repoint" | "duplicate_paused";
  adId: string;
  creativeId: string;
  campaignId?: string;
  adsetId?: string;
  previousPromotionUrl?: string;
  newPromotionUrl: string;
  pausedAdId?: string;
  message?: string;
};

const SALES_OBJECTIVES = new Set(["OUTCOME_SALES", "CONVERSIONS"]);
const OPT_OUT_MULTI_ADS = JSON.stringify({ enroll_status: "OPT_OUT" });

const CREATIVE_FIELDS = [
  "id",
  "name",
  "object_id",
  "object_story_id",
  "effective_object_story_id",
  "instagram_user_id",
  "source_instagram_media_id",
  "call_to_action",
  "url_tags",
  "object_story_spec",
  "asset_feed_spec",
].join(",");

function clientError(
  statusCode: number,
  title: string,
  message: string,
  solution: string,
): GraphApiError {
  return new GraphApiError({
    statusCode,
    reason: {
      httpStatusCode: statusCode,
      title,
      message,
      solution,
      isTransient: false,
    },
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function extractPageIdFromStoryId(storyId: string | undefined): string | undefined {
  const [pageId] = storyId?.split("_") ?? [];
  return pageId || undefined;
}

function setCtaLink(
  cta: GraphCallToAction | undefined,
  promotionUrl: string,
): GraphCallToAction {
  return {
    ...(cta ?? {}),
    type: cta?.type ?? "ORDER_NOW",
    value: {
      ...(cta?.value ?? {}),
      link: promotionUrl,
    },
  };
}

function extractPromotionUrl(creative: GraphCreative): string | undefined {
  return (
    creative.call_to_action?.value?.link ??
    creative.object_story_spec?.link_data?.call_to_action?.value?.link ??
    creative.object_story_spec?.link_data?.link ??
    creative.object_story_spec?.video_data?.call_to_action?.value?.link ??
    creative.object_story_spec?.template_data?.call_to_action?.value?.link ??
    creative.object_story_spec?.template_data?.link ??
    creative.asset_feed_spec?.link_urls?.find((link) => link.website_url)
      ?.website_url
  );
}

function extractCtaType(creative: GraphCreative): string | undefined {
  return (
    creative.call_to_action?.type ??
    creative.object_story_spec?.link_data?.call_to_action?.type ??
    creative.object_story_spec?.video_data?.call_to_action?.type ??
    creative.object_story_spec?.template_data?.call_to_action?.type
  );
}

async function resolveInstagramPostIdentity(args: {
  creative: GraphCreative;
  accessToken: string;
}): Promise<{ pageId?: string; instagramUserId?: string }> {
  const pageId =
    args.creative.object_id ??
    args.creative.object_story_spec?.page_id ??
    extractPageIdFromStoryId(args.creative.effective_object_story_id) ??
    extractPageIdFromStoryId(args.creative.object_story_id);
  const instagramUserId =
    args.creative.instagram_user_id ??
    args.creative.object_story_spec?.instagram_user_id;

  if (pageId && instagramUserId) {
    return { pageId, instagramUserId };
  }

  const pages = await metaApiCall<GraphPagesWithInstagramResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: "me/accounts",
    params: "fields=id,instagram_business_account{id}",
    accessToken: args.accessToken,
  });

  if (pageId) {
    const matchedPage = pages.data?.find((page) => page.id === pageId);
    return {
      pageId,
      instagramUserId:
        instagramUserId ?? matchedPage?.instagram_business_account?.id,
    };
  }

  const pagesWithIg =
    pages.data?.filter((page) => page.instagram_business_account?.id) ?? [];
  if (pagesWithIg.length === 1) {
    return {
      pageId: pagesWithIg[0].id,
      instagramUserId: pagesWithIg[0].instagram_business_account?.id,
    };
  }

  return { pageId, instagramUserId };
}

async function fetchAdAndCreative(args: {
  adId: string;
  accessToken: string;
}): Promise<{ ad: GraphAd; creative: GraphCreative }> {
  const ad = await metaApiCall<GraphAd>({
    domain: "FACEBOOK",
    method: "GET",
    path: args.adId,
    params:
      "fields=id,name,adset_id,campaign_id,campaign{id,objective},creative{id}",
    accessToken: args.accessToken,
  });

  const creativeId = ad.creative?.id;
  if (!creativeId) {
    throw clientError(
      404,
      "Criativo não encontrado",
      "Não foi possível encontrar o criativo vinculado a este anúncio.",
      "Atualize a campanha e tente novamente.",
    );
  }

  const creative = await metaApiCall<GraphCreative>({
    domain: "FACEBOOK",
    method: "GET",
    path: creativeId,
    params: `fields=${CREATIVE_FIELDS}`,
    accessToken: args.accessToken,
  });

  return { ad, creative };
}

function assertSalesCampaign(ad: GraphAd): void {
  const objective = ad.campaign?.objective;
  if (!objective || !SALES_OBJECTIVES.has(objective)) {
    throw clientError(
      400,
      "Anúncio não é de vendas",
      "A edição do link de promoção está disponível apenas para anúncios de campanhas de vendas.",
      "Selecione um anúncio de uma campanha de vendas para alterar o link.",
    );
  }
}

async function createCreativeWithPromotionUrl(args: {
  accountId: string;
  accessToken: string;
  ad: GraphAd;
  creative: GraphCreative;
  promotionUrl: string;
}): Promise<string> {
  const { accountId, accessToken, ad, creative, promotionUrl } = args;
  const body = new URLSearchParams({
    name: `${creative.name ?? ad.name ?? "Anúncio"} - link atualizado`,
    contextual_multi_ads: OPT_OUT_MULTI_ADS,
  });

  if (creative.url_tags) {
    body.set("url_tags", creative.url_tags);
  }

  if (creative.source_instagram_media_id) {
    const { pageId, instagramUserId } = await resolveInstagramPostIdentity({
      creative,
      accessToken,
    });

    if (!pageId || !instagramUserId) {
      console.warn("TODELETE  - promotion-link missing Instagram identity", {
        creativeId: creative.id,
        sourceInstagramMediaId: creative.source_instagram_media_id,
        objectId: creative.object_id,
        objectStorySpecPageId: creative.object_story_spec?.page_id,
        effectiveObjectStoryId: creative.effective_object_story_id,
        objectStoryId: creative.object_story_id,
        resolvedPageId: pageId,
        hasResolvedInstagramUserId: Boolean(instagramUserId),
      });
      throw clientError(
        400,
        "Identidade do criativo indisponível",
        "Não foi possível identificar a Página e a conta do Instagram usadas neste anúncio.",
        "Recrie o anúncio ou edite o criativo completo antes de tentar trocar apenas o link.",
      );
    }

    body.set("source_instagram_media_id", creative.source_instagram_media_id);
    body.set("object_id", pageId);
    body.set("instagram_user_id", instagramUserId);
    body.set(
      "call_to_action",
      JSON.stringify(setCtaLink(creative.call_to_action, promotionUrl)),
    );
  } else if (creative.asset_feed_spec?.link_urls?.length) {
    const objectStorySpec = cloneJson(creative.object_story_spec ?? {});
    const assetFeedSpec = cloneJson(creative.asset_feed_spec);
    assetFeedSpec.link_urls = assetFeedSpec.link_urls?.map((link) => ({
      ...link,
      website_url: promotionUrl,
    }));

    body.set("object_story_spec", JSON.stringify(objectStorySpec));
    body.set("asset_feed_spec", JSON.stringify(assetFeedSpec));
  } else if (creative.object_story_spec?.link_data) {
    const objectStorySpec = cloneJson(creative.object_story_spec);
    objectStorySpec.link_data = {
      ...objectStorySpec.link_data,
      link: promotionUrl,
      call_to_action: setCtaLink(
        objectStorySpec.link_data?.call_to_action,
        promotionUrl,
      ),
    };
    body.set("object_story_spec", JSON.stringify(objectStorySpec));
  } else if (creative.object_story_spec?.video_data) {
    const objectStorySpec = cloneJson(creative.object_story_spec);
    objectStorySpec.video_data = {
      ...objectStorySpec.video_data,
      call_to_action: setCtaLink(
        objectStorySpec.video_data?.call_to_action,
        promotionUrl,
      ),
    };
    body.set("object_story_spec", JSON.stringify(objectStorySpec));
  } else {
    throw clientError(
      400,
      "Formato de criativo não suportado",
      "Não foi possível trocar apenas o link deste criativo mantendo a mídia atual.",
      "Use um anúncio de vendas com post do Instagram, imagem, vídeo ou criativo dinâmico.",
    );
  }

  const response = await metaApiCall<CreateCreativeResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${normalizeAccountId(accountId)}/adcreatives`,
    params: "",
    body,
    accessToken,
  });

  return response.id;
}

async function repointAd(args: {
  adId: string;
  creativeId: string;
  accessToken: string;
}): Promise<void> {
  await metaApiCall<{ success?: boolean; id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: args.adId,
    params: "",
    body: new URLSearchParams({
      creative: JSON.stringify({ creative_id: args.creativeId }),
    }),
    accessToken: args.accessToken,
  });
}

function isRepointRejected(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  const { statusCode, reason } = error.errorReturn;
  return statusCode >= 400 && statusCode < 500 && !reason.isTransient;
}

async function pauseAd(adId: string, accessToken: string): Promise<void> {
  await metaApiCall<{ success?: boolean }>({
    domain: "FACEBOOK",
    method: "POST",
    path: adId,
    params: "",
    body: new URLSearchParams({ status: "PAUSED" }),
    accessToken,
  });
}

export async function getPromotionLinkDetails(args: {
  adId: string;
  accessToken: string;
}): Promise<PromotionLinkDetails> {
  const { ad, creative } = await fetchAdAndCreative(args);
  assertSalesCampaign(ad);

  return {
    adId: ad.id,
    creativeId: creative.id,
    campaignObjective: ad.campaign?.objective,
    promotionUrl: extractPromotionUrl(creative),
    ctaType: extractCtaType(creative),
  };
}

export async function updatePromotionLink(args: {
  accountId: string;
  adId: string;
  accessToken: string;
  promotionUrl: string;
}): Promise<PromotionLinkUpdateResult> {
  const { ad, creative } = await fetchAdAndCreative(args);
  assertSalesCampaign(ad);

  const previousPromotionUrl = extractPromotionUrl(creative);
  const creativeId = await createCreativeWithPromotionUrl({
    accountId: args.accountId,
    accessToken: args.accessToken,
    ad,
    creative,
    promotionUrl: args.promotionUrl,
  });

  try {
    await repointAd({
      adId: args.adId,
      creativeId,
      accessToken: args.accessToken,
    });
    return {
      strategy: "repoint",
      adId: args.adId,
      campaignId: ad.campaign_id,
      adsetId: ad.adset_id,
      creativeId,
      previousPromotionUrl,
      newPromotionUrl: args.promotionUrl,
    };
  } catch (error) {
    if (!isRepointRejected(error)) {
      throw error;
    }

    const copy = await duplicateAd({
      accountId: args.accountId,
      adId: args.adId,
      accessToken: args.accessToken,
    });
    await repointAd({
      adId: copy.id,
      creativeId,
      accessToken: args.accessToken,
    });
    await pauseAd(args.adId, args.accessToken);

    return {
      strategy: "duplicate_paused",
      adId: copy.id,
      campaignId: ad.campaign_id,
      adsetId: ad.adset_id,
      pausedAdId: args.adId,
      creativeId,
      previousPromotionUrl,
      newPromotionUrl: args.promotionUrl,
      message:
        "O anúncio original estava ativo/com engajamento, então um novo anúncio foi criado no mesmo conjunto com o novo link e o original foi pausado.",
    };
  }
}
