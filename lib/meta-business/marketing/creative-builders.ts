import { fetchMetaGraph } from "@/lib/observability/meta-fetch";
import { graphFacebookBaseUrl, graphApiVersion } from "../constant";
import { throwMetaError } from "./meta-error";
import { uploadImageToAdAccount } from "./upload-ad-image";

export type CreateAdCreativeResponse = { id: string };
export type CreateAdResponse = { id: string };

const DEFAULT_CTA = "ORDER_NOW";
const DEFAULT_MESSAGE = "Confira nossa oferta especial!";

// Disable multi-advertiser ads so Meta does not show other advertisers'
// ads alongside this one.
const OPT_OUT_MULTI_ADS = JSON.stringify({ enroll_status: "OPT_OUT" });

const ADCREATIVES_PATH = (adAccountId: string) =>
  `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/adcreatives`;

/**
 * Create an ad creative from an existing Instagram post, preserving the
 * original post content. For most objectives a call_to_action with a link is
 * required.
 *
 * See: https://developers.facebook.com/docs/instagram/ads-api/guides/use-posts-as-ads
 */
export async function createAdCreativeFromInstagramPost(params: {
  adAccountId: string;
  accessToken: string;
  name: string;
  instagramMediaId: string;
  pageId: string;
  instagramAccountId: string;
  url: string;
  ctaType?: string;
}): Promise<CreateAdCreativeResponse> {
  const {
    adAccountId,
    accessToken,
    name,
    instagramMediaId,
    pageId,
    instagramAccountId,
    url: promotionUrl,
    ctaType = DEFAULT_CTA,
  } = params;

  const callToAction = {
    type: ctaType,
    value: { link: promotionUrl },
  };

  const formData = new FormData();
  formData.append("name", name);
  formData.append("source_instagram_media_id", instagramMediaId);
  formData.append("object_id", pageId);
  formData.append("instagram_user_id", instagramAccountId);
  formData.append("call_to_action", JSON.stringify(callToAction));
  formData.append("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(ADCREATIVES_PATH(adAccountId), {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "adcreative",
    operation: "create",
  });

  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating ad creative from Instagram post:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdCreativeResponse;
}

/**
 * Create a Dynamic Creative image ad: Meta auto-tests title/body combinations.
 */
export async function createDynamicAdCreative(params: {
  adAccountId: string;
  accessToken: string;
  name: string;
  pageId: string;
  instagramAccountId: string;
  url: string;
  imageUrl: string;
  titles: string[];
  texts: string[];
  ctaType?: string;
}): Promise<CreateAdCreativeResponse> {
  const {
    adAccountId,
    accessToken,
    name,
    pageId,
    instagramAccountId,
    url,
    imageUrl,
    titles,
    texts,
    ctaType = DEFAULT_CTA,
  } = params;

  const { hash: imageHash } = await uploadImageToAdAccount({
    adAccountId,
    accessToken,
    imageUrl,
  });

  const assetFeedSpec = {
    images: [{ hash: imageHash }],
    titles: titles.map((text) => ({ text })),
    bodies: texts.map((text) => ({ text })),
    ad_formats: ["SINGLE_IMAGE"],
    call_to_action_types: [ctaType],
    link_urls: [{ website_url: url }],
  };

  const objectStorySpec = {
    page_id: pageId,
    instagram_user_id: instagramAccountId,
  };


  const formData = new FormData();
  formData.append("name", name);
  formData.append("object_story_spec", JSON.stringify(objectStorySpec));
  formData.append("asset_feed_spec", JSON.stringify(assetFeedSpec));
  formData.append("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(ADCREATIVES_PATH(adAccountId), {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "adcreative",
    operation: "create",
  });


  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating dynamic ad creative:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdCreativeResponse;
}

/**
 * Create a standard single-image link ad creative.
 */
export async function createAdCreative(params: {
  adAccountId: string;
  accessToken: string;
  name: string;
  pageId: string;
  instagramAccountId: string;
  url: string;
  imageUrl: string;
  headline?: string;
  bodyText?: string;
  ctaType?: string;
}): Promise<CreateAdCreativeResponse> {
  const {
    adAccountId,
    accessToken,
    name,
    pageId,
    instagramAccountId,
    url,
    imageUrl,
    headline,
    bodyText,
    ctaType = DEFAULT_CTA,
  } = params;

  const { hash: imageHash } = await uploadImageToAdAccount({
    adAccountId,
    accessToken,
    imageUrl,
  });

  const objectStorySpec = {
    page_id: pageId,
    instagram_user_id: instagramAccountId,
    link_data: {
      link: url,
      message: bodyText ?? DEFAULT_MESSAGE,
      image_hash: imageHash,
      ...(headline ? { name: headline } : {}),
      call_to_action: {
        type: ctaType,
        value: { link: url },
      },
    },
  };

  const formData = new FormData();
  formData.append("name", name);
  formData.append("object_story_spec", JSON.stringify(objectStorySpec));
  formData.append("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(ADCREATIVES_PATH(adAccountId), {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "adcreative",
    operation: "create",
  });

  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating ad creative:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdCreativeResponse;
}

/**
 * Create a single-video link ad creative.
 */
export async function createVideoAdCreative(params: {
  adAccountId: string;
  accessToken: string;
  name: string;
  pageId: string;
  instagramAccountId: string;
  url: string;
  videoId: string;
  thumbnailUrl: string;
  headline?: string;
  bodyText?: string;
  ctaType?: string;
}): Promise<CreateAdCreativeResponse> {
  const {
    adAccountId,
    accessToken,
    name,
    pageId,
    instagramAccountId,
    url: promotionUrl,
    videoId,
    thumbnailUrl,
    headline,
    bodyText,
    ctaType = DEFAULT_CTA,
  } = params;

  const objectStorySpec = {
    page_id: pageId,
    instagram_user_id: instagramAccountId,
    video_data: {
      video_id: videoId,
      image_url: thumbnailUrl,
      message: bodyText ?? DEFAULT_MESSAGE,
      title: headline ?? "",
      call_to_action: {
        type: ctaType,
        value: { link: promotionUrl },
      },
    },
  };

  const formData = new FormData();
  formData.append("name", name);
  formData.append("object_story_spec", JSON.stringify(objectStorySpec));
  formData.append("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(ADCREATIVES_PATH(adAccountId), {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "adcreative",
    operation: "create",
  });

  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating video ad creative:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdCreativeResponse;
}

/**
 * Create a Dynamic Creative video ad: Meta auto-tests title/body combinations.
 */
export async function createDynamicVideoAdCreative(params: {
  adAccountId: string;
  accessToken: string;
  name: string;
  pageId: string;
  instagramAccountId: string;
  url: string;
  videoId: string;
  thumbnailUrl: string;
  titles: string[];
  texts: string[];
  ctaType?: string;
}): Promise<CreateAdCreativeResponse> {
  const {
    adAccountId,
    accessToken,
    name,
    pageId,
    instagramAccountId,
    url: promotionUrl,
    videoId,
    thumbnailUrl,
    titles,
    texts,
    ctaType = DEFAULT_CTA,
  } = params;

  const assetFeedSpec = {
    videos: [{ video_id: videoId, thumbnail_url: thumbnailUrl }],
    titles: titles.map((text) => ({ text })),
    bodies: texts.map((text) => ({ text })),
    ad_formats: ["SINGLE_VIDEO"],
    call_to_action_types: [ctaType],
    link_urls: [{ website_url: promotionUrl }],
  };

  const objectStorySpec = {
    page_id: pageId,
    instagram_user_id: instagramAccountId,
  };

  const formData = new FormData();
  formData.append("name", name);
  formData.append("object_story_spec", JSON.stringify(objectStorySpec));
  formData.append("asset_feed_spec", JSON.stringify(assetFeedSpec));
  formData.append("contextual_multi_ads", OPT_OUT_MULTI_ADS);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(ADCREATIVES_PATH(adAccountId), {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "adcreative",
    operation: "create",
  });

  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating dynamic video ad creative:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdCreativeResponse;
}

/**
 * Create an ad linking an ad set to a creative.
 */
export async function createAd(params: {
  adAccountId: string;
  accessToken: string;
  adSetId: string;
  creativeId: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
}): Promise<CreateAdResponse> {
  const { adAccountId, accessToken, adSetId, creativeId, name, status } =
    params;

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/ads`;


  const formData = new FormData();
  formData.append("name", name);
  formData.append("adset_id", adSetId);
  formData.append("creative", JSON.stringify({ creative_id: creativeId }));
  formData.append("status", status);
  formData.append("access_token", accessToken);

  const { response, data } = await fetchMetaGraph(url, {
    method: "POST",
    body: formData,
    requestParams: formData,
    entity: "ad",
    operation: "create",
  });


  if (!response.ok || (data as { error?: unknown }).error) {
    console.error("Error creating ad:", data);
    throwMetaError(data, response.status);
  }

  return data as CreateAdResponse;
}
