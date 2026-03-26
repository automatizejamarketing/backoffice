import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  AdSetStatus,
  CampaignObjective,
  type AdSet,
  type GraphApiAdSet,
  type GraphPaging,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import { transformAdSet, transformPaging } from "@/lib/meta-business/transformers";

type GraphApiAdSetsResponse = {
  data: GraphApiAdSet[];
  paging?: GraphPaging;
};

type GraphApiUpdateAdSetResponse = {
  success: boolean;
};

export type GetAdSetsResponse = Partial<{
  data: AdSet[];
  pagination: PaginationInfo;
}>;

export type PatchAdSetRequestBody = {
  adsetId: string;
  status: AdSetStatus;
};

export type PatchAdSetResponse = {
  success: boolean;
  adset?: {
    id: string;
    status: AdSetStatus;
  };
};

export type AdSetsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function buildAdSetFields(): string {
  const insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,date_start,date_stop}";

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "start_time",
    "end_time",
    "created_time",
    "updated_time",
    "optimization_goal",
    "billing_event",
    "bid_amount",
    "targeting",
    insightsFields,
  ].join(",");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetAdSetsResponse | AdSetsErrorResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 }
      );
    }

    const { accountId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 }
      );
    }

    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode }
      );
    }

    const { accessToken } = tokenResult;

    const limitParam = searchParams.get("limit");
    const after = searchParams.get("after");
    const before = searchParams.get("before");
    const campaignId = searchParams.get("campaignId");
    const effectiveStatus = searchParams.get("effectiveStatus");

    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    const fields = buildAdSetFields();
    const queryParams: string[] = [`fields=${fields}`, `limit=${limit}`];

    if (after) {
      queryParams.push(`after=${after}`);
    }
    if (before) {
      queryParams.push(`before=${before}`);
    }
    if (campaignId) {
      queryParams.push(`filtering=[{"field":"campaign.id","operator":"EQUAL","value":"${campaignId}"}]`);
    }
    if (effectiveStatus) {
      const statusArray = effectiveStatus.split(",").map((s) => s.trim());
      queryParams.push(
        `effective_status=${encodeURIComponent(JSON.stringify(statusArray))}`
      );
    }

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const response = await metaApiCall<GraphApiAdSetsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formattedAccountId}/adsets`,
      params: queryParams.join("&"),
      accessToken,
    });

    const adsets = response.data.map(transformAdSet);
    const pagination = transformPaging(response.paging);

    return NextResponse.json(
      {
        data: adsets,
        pagination,
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching adsets:", errorReturn);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode }
    );
  }
}

// ================================
// POST – Create new adset (+ ad if creative provided)
// ================================

type GraphApiPage = {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
};

type GraphApiPagesResponse = {
  data: GraphApiPage[];
};

type GraphApiPixel = { id: string; name?: string };
type GraphApiPixelsResponse = { data: GraphApiPixel[] };

type CreateAdSetApiResponse = { id: string };
type CreateAdCreativeApiResponse = { id: string };
type CreateAdApiResponse = { id: string };

export type PostAdSetRequestBody = {
  userId: string;
  campaignId: string;
  campaignObjective?: string;
  adsetName: string;
  dailyBudget: number;
  targeting: {
    age_min: number;
    age_max: number;
    genders?: number[];
    custom_audiences?: { id: string; name?: string }[];
    excluded_custom_audiences?: { id: string; name?: string }[];
  };
  /** @deprecated Use `creatives` instead */
  creative?: {
    instagramMediaId: string;
  };
  /** Array of Instagram media to create as ads (1-5 items) */
  creatives?: Array<{
    instagramMediaId: string;
  }>;
  /** URL for SALES campaigns (required when creatives are provided for OUTCOME_SALES) */
  url?: string;
};

export type PostAdSetResponse = {
  success: boolean;
  adsetId: string;
  adsetName: string;
  /** @deprecated Use `ads` instead */
  adId?: string;
  /** @deprecated Use `adCreatives` instead */
  adCreativeId?: string;
  ads?: Array<{ id: string; creativeId: string }>;
  adCreatives?: Array<{ id: string }>;
};

type PromotedObjectType =
  | "page"            // { page_id } — LEADS, ENGAGEMENT, AWARENESS, default
  | "instagram_traffic" // { page_id, instagram_profile_id } — TRAFFIC
  | "pixel_conversion"; // { pixel_id, custom_event_type } — SALES

type OptimizationConfig = {
  optimizationGoal: string;
  billingEvent: string;
  destinationType?: string;
  promotedObjectType: PromotedObjectType;
  instagramOnlyPlacements?: boolean;
};

function getOptimizationConfig(objective?: string): OptimizationConfig {
  switch (objective) {
    case CampaignObjective.OUTCOME_LEADS:
    case CampaignObjective.LEAD_GENERATION:
      return {
        optimizationGoal: "LEAD_GENERATION",
        billingEvent: "IMPRESSIONS",
        destinationType: "ON_AD",
        promotedObjectType: "page",
      };
    case CampaignObjective.OUTCOME_TRAFFIC:
    case CampaignObjective.LINK_CLICKS:
      // VISIT_INSTAGRAM_PROFILE requires:
      //   destination_type: INSTAGRAM_PROFILE
      //   promoted_object: { page_id, instagram_profile_id }
      //   Instagram-only placements
      return {
        optimizationGoal: "VISIT_INSTAGRAM_PROFILE",
        billingEvent: "IMPRESSIONS",
        destinationType: "INSTAGRAM_PROFILE",
        promotedObjectType: "instagram_traffic",
        instagramOnlyPlacements: true,
      };
    case CampaignObjective.OUTCOME_ENGAGEMENT:
    case CampaignObjective.POST_ENGAGEMENT:
      return {
        optimizationGoal: "POST_ENGAGEMENT",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
      };
    case CampaignObjective.OUTCOME_AWARENESS:
    case CampaignObjective.BRAND_AWARENESS:
    case CampaignObjective.REACH:
      return {
        optimizationGoal: "REACH",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
      };
    case CampaignObjective.OUTCOME_SALES:
    case CampaignObjective.CONVERSIONS:
      // OFFSITE_CONVERSIONS requires:
      //   promoted_object: { pixel_id, custom_event_type: "PURCHASE" }
      return {
        optimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "pixel_conversion",
      };
    case CampaignObjective.VIDEO_VIEWS:
      return {
        optimizationGoal: "THRUPLAY",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
      };
    default:
      return {
        optimizationGoal: "REACH",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
      };
  }
}

/**
 * Get the privacy policy URL from environment variable or use default
 */
function getPrivacyPolicyUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return `${appUrl}/lgpd`;
  }
  return "https://www.automatizemarketing.com/lgpd";
}

/**
 * Get the website URL (without /lgpd path)
 */
function getWebsiteUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return appUrl ?? "https://www.automatizemarketing.com";
}

type CreateLeadFormResponse = { id: string };

/**
 * Create a lead form on the Facebook Page
 * The form collects: Full Name, Email, Phone
 * Locale: PT_BR (Portuguese Brazil)
 */
async function createLeadForm(params: {
  pageId: string;
  accessToken: string;
  name: string;
}): Promise<CreateLeadFormResponse> {
  const { pageId, accessToken, name } = params;

  const privacyPolicyUrl = getPrivacyPolicyUrl();
  const websiteUrl = getWebsiteUrl();

  const questions = [
    { type: "FULL_NAME", key: "full_name" },
    { type: "EMAIL", key: "email" },
    { type: "PHONE", key: "phone" },
  ];

  const thankYouPage = {
    title: "Obrigado pelo seu interesse!",
    body: "Recebemos suas informações e entraremos em contato em breve.",
    button_type: "VIEW_WEBSITE",
    button_text: "Visitar site",
    website_url: websiteUrl,
  };

  const privacyPolicy = {
    url: privacyPolicyUrl,
    link_text: "Política de Privacidade",
  };

  const formData = new URLSearchParams({
    name,
    questions: JSON.stringify(questions),
    privacy_policy: JSON.stringify(privacyPolicy),
    thank_you_page: JSON.stringify(thankYouPage),
    locale: "PT_BR",
    block_display_for_non_targeted_viewer: "true",
  });

  const response = await metaApiCall<CreateLeadFormResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${pageId}/leadgen_forms`,
    params: "",
    body: formData,
    accessToken,
  });

  return response;
}

/**
 * Delete a Meta ad object (used for rollback)
 */
async function deleteMetaObject(
  objectId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    await metaApiCall<{ success: boolean }>({
      domain: "FACEBOOK",
      method: "DELETE",
      path: objectId,
      params: "",
      accessToken,
    });
    return true;
  } catch (error) {
    console.log("TODELETE - ", error);
    console.error(`[deleteMetaObject] Failed to delete ${objectId}`);
    return false;
  }
}

type CallToAction = {
  type: string;
  value: Record<string, string>;
};

/**
 * Build the call_to_action object based on campaign objective
 * Returns undefined for objectives that don't require a CTA
 */
function buildCallToAction(params: {
  campaignObjective?: string;
  url?: string;
  instagramProfileUrl?: string;
  leadFormId?: string;
}): CallToAction | undefined {
  const { campaignObjective, url, instagramProfileUrl, leadFormId } = params;

  switch (campaignObjective) {
    case CampaignObjective.OUTCOME_SALES:
    case CampaignObjective.CONVERSIONS:
      if (!url) return undefined;
      return {
        type: "ORDER_NOW",
        value: { link: url },
      };

    case CampaignObjective.OUTCOME_TRAFFIC:
    case CampaignObjective.LINK_CLICKS:
      if (!instagramProfileUrl) return undefined;
      return {
        type: "LEARN_MORE",
        value: { link: instagramProfileUrl },
      };

    case CampaignObjective.OUTCOME_LEADS:
    case CampaignObjective.LEAD_GENERATION:
      if (!leadFormId) return undefined;
      return {
        type: "SIGN_UP",
        value: {
          lead_gen_form_id: leadFormId,
          link: getWebsiteUrl(),
        },
      };

    default:
      return undefined;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<PostAdSetResponse | AdSetsErrorResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 },
      );
    }

    const { accountId } = await params;
    const body: PostAdSetRequestBody = await request.json();
    const {
      userId,
      campaignId,
      campaignObjective,
      adsetName,
      dailyBudget,
      targeting,
      creative,
      creatives: rawCreatives,
      url,
    } = body;

    const creatives =
      rawCreatives && rawCreatives.length > 0
        ? rawCreatives
        : creative
          ? [creative]
          : [];

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId is required in the request body",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    if (!campaignId) {
      return NextResponse.json(
        {
          error: "Missing campaignId",
          message: "campaignId is required",
          solution: "Provide the campaign ID for the new adset",
        },
        { status: 400 },
      );
    }

    if (!adsetName?.trim()) {
      return NextResponse.json(
        {
          error: "Missing adsetName",
          message: "adsetName is required",
          solution: "Provide a name for the new adset",
        },
        { status: 400 },
      );
    }

    if (!dailyBudget || dailyBudget < 1) {
      return NextResponse.json(
        {
          error: "Invalid dailyBudget",
          message: "Daily budget must be at least R$ 1,00",
          solution: "Provide a valid daily budget",
        },
        { status: 400 },
      );
    }

    if (creatives.length > 5) {
      return NextResponse.json(
        {
          error: "Too many creatives",
          message: "No máximo 5 criativos por conjunto de anúncios.",
          solution: "Selecione até 5 posts do Instagram.",
        },
        { status: 400 },
      );
    }

    const isSalesCampaign =
      campaignObjective === CampaignObjective.OUTCOME_SALES ||
      campaignObjective === CampaignObjective.CONVERSIONS;

    if (isSalesCampaign && creatives.length > 0 && !url) {
      return NextResponse.json(
        {
          error: "Missing URL",
          message:
            "Campanhas de vendas requerem uma URL de destino para o anúncio.",
          solution:
            "Forneça a URL do produto ou página de destino para o anúncio.",
        },
        { status: 400 },
      );
    }

    // Validate URL format if provided
    if (url && !url.startsWith("https://")) {
      return NextResponse.json(
        {
          error: "Invalid URL",
          message: "A URL deve começar com https://",
          solution: "Forneça uma URL válida começando com https://",
        },
        { status: 400 },
      );
    }

    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }

    const { accessToken } = tokenResult;

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const {
      optimizationGoal,
      billingEvent,
      destinationType,
      promotedObjectType,
      instagramOnlyPlacements,
    } = getOptimizationConfig(campaignObjective);

    // Fetch connected Facebook Page (needed for promoted_object and creative).
    const pagesResponse = await metaApiCall<GraphApiPagesResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: "me/accounts",
      params: "fields=id,name,instagram_business_account{id,username}",
      accessToken,
    });

    const pageWithIg = pagesResponse.data.find(
      (p) => p.instagram_business_account?.id,
    );
    const connectedPage = pageWithIg ?? pagesResponse.data[0];

    if (!connectedPage) {
      return NextResponse.json(
        {
          error: "No Facebook Page found",
          message:
            "Nenhuma Página do Facebook encontrada para esta conta Meta. A Página é necessária para criar o conjunto de anúncios.",
          solution:
            "Conecte uma Página do Facebook à conta Meta do usuário e tente novamente.",
        },
        { status: 400 },
      );
    }

    // Build promoted_object based on campaign objective:
    // - LEADS/ENGAGEMENT/AWARENESS/default → { page_id }
    // - TRAFFIC (VISIT_INSTAGRAM_PROFILE)  → { page_id, instagram_profile_id }
    // - SALES (OFFSITE_CONVERSIONS)        → { pixel_id, custom_event_type }
    let promotedObject: Record<string, string>;

    if (promotedObjectType === "instagram_traffic") {
      const igAccountId = pageWithIg?.instagram_business_account?.id;
      if (!igAccountId) {
        return NextResponse.json(
          {
            error: "No Instagram Business Account",
            message:
              "Esta campanha de tráfego requer uma conta de Instagram Business conectada à Página do Facebook.",
            solution:
              "Conecte uma conta de Instagram Business a uma Página do Facebook e tente novamente.",
          },
          { status: 400 },
        );
      }
      promotedObject = {
        page_id: connectedPage.id,
        instagram_profile_id: igAccountId,
      };
    } else if (promotedObjectType === "pixel_conversion") {
      // Fetch the first available pixel for this ad account
      const pixelsResponse = await metaApiCall<GraphApiPixelsResponse>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${formattedAccountId}/adspixels`,
        params: "fields=id,name&limit=1",
        accessToken,
      });

      const pixel = pixelsResponse.data[0];
      if (!pixel) {
        return NextResponse.json(
          {
            error: "No Meta Pixel found",
            message:
              "Esta campanha de vendas requer um Pixel Meta configurado na conta de anúncios.",
            solution:
              "Crie ou conecte um Pixel Meta à conta de anúncios e tente novamente.",
          },
          { status: 400 },
        );
      }
      promotedObject = {
        pixel_id: pixel.id,
        custom_event_type: "PURCHASE",
      };
    } else {
      promotedObject = { page_id: connectedPage.id };
    }

    // Build targeting – always use Brazil as geo.
    // OUTCOME_TRAFFIC (VISIT_INSTAGRAM_PROFILE) uses Instagram-only placements.
    const metaTargeting: Record<string, unknown> = {
      geo_locations: { countries: ["BR"] },
      age_min: targeting.age_min ?? 18,
      age_max: targeting.age_max ?? 65,
      ...(instagramOnlyPlacements
        ? {
            publisher_platforms: ["instagram"],
            instagram_positions: ["stream", "story", "reels"],
          }
        : {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["feed", "story", "facebook_reels"],
            instagram_positions: ["stream", "story", "reels"],
          }),
      targeting_automation: { advantage_audience: 0 },
      targeting_relaxation_types: { custom_audience: 0 },
    };

    if (targeting.genders && targeting.genders.length > 0) {
      metaTargeting.genders = targeting.genders;
    }

    if (targeting.custom_audiences && targeting.custom_audiences.length > 0) {
      metaTargeting.custom_audiences = targeting.custom_audiences.map((a) => ({
        id: a.id,
      }));
    }

    if (
      targeting.excluded_custom_audiences &&
      targeting.excluded_custom_audiences.length > 0
    ) {
      metaTargeting.excluded_custom_audiences =
        targeting.excluded_custom_audiences.map((a) => ({ id: a.id }));
    }

    // Build adset create params
    const adsetParams = new URLSearchParams({
      name: adsetName.trim(),
      campaign_id: campaignId,
      daily_budget: Math.round(dailyBudget * 100).toString(),
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: JSON.stringify(metaTargeting),
      promoted_object: JSON.stringify(promotedObject),
      status: "ACTIVE",
    });

    if (destinationType) {
      adsetParams.set("destination_type", destinationType);
    }

    const createdAdSet = await metaApiCall<CreateAdSetApiResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${formattedAccountId}/adsets`,
      params: "",
      body: adsetParams,
      accessToken,
    });

    const adsetId = createdAdSet.id;
    const createdAds: Array<{ id: string; creativeId: string }> = [];
    const createdAdCreatives: Array<{ id: string }> = [];
    let leadFormId: string | undefined;

    if (creatives.length > 0 && pageWithIg?.instagram_business_account) {
      const pageId = pageWithIg.id;
      const igAccountId = pageWithIg.instagram_business_account.id;
      const igUsername = pageWithIg.instagram_business_account.username;

      const instagramProfileUrl = igUsername
        ? `https://www.instagram.com/${igUsername}`
        : undefined;

      const isLeadsCampaign =
        campaignObjective === CampaignObjective.OUTCOME_LEADS ||
        campaignObjective === CampaignObjective.LEAD_GENERATION;

      try {
        if (isLeadsCampaign) {
          const leadForm = await createLeadForm({
            pageId,
            accessToken,
            name: `${adsetName.trim()} - Formulário`,
          });
          leadFormId = leadForm.id;
        }

        const callToAction = buildCallToAction({
          campaignObjective,
          url,
          instagramProfileUrl,
          leadFormId,
        });

        for (let i = 0; i < creatives.length; i++) {
          const source = creatives[i];
          const suffix = creatives.length > 1 ? ` ${i + 1}` : "";

          const creativeParams = new URLSearchParams({
            name: `${adsetName.trim()} - Creative${suffix}`,
            source_instagram_media_id: source.instagramMediaId,
            object_id: pageId,
            instagram_user_id: igAccountId,
            contextual_multi_ads: JSON.stringify({ enroll_status: "OPT_OUT" }),
          });

          if (callToAction) {
            creativeParams.set(
              "call_to_action",
              JSON.stringify(callToAction),
            );
          }

          const createdCreative =
            await metaApiCall<CreateAdCreativeApiResponse>({
              domain: "FACEBOOK",
              method: "POST",
              path: `${formattedAccountId}/adcreatives`,
              params: "",
              body: creativeParams,
              accessToken,
            });

          createdAdCreatives.push({ id: createdCreative.id });

          const adParams = new URLSearchParams({
            name: `${adsetName.trim()} - Ad${suffix}`,
            adset_id: adsetId,
            creative: JSON.stringify({ creative_id: createdCreative.id }),
            status: "ACTIVE",
          });

          const createdAd = await metaApiCall<CreateAdApiResponse>({
            domain: "FACEBOOK",
            method: "POST",
            path: `${formattedAccountId}/ads`,
            params: "",
            body: adParams,
            accessToken,
          });

          createdAds.push({ id: createdAd.id, creativeId: createdCreative.id });
        }
      } catch (creativeError) {
        if (leadFormId) {
          console.log(
            `[POST /adsets] Rolling back lead form ${leadFormId}...`,
          );
          await deleteMetaObject(leadFormId, accessToken);
        }

        console.error(
          "[POST /adsets] Failed to create creative/ad:",
          creativeError,
        );
        const creativeErrorReturn = errorToGraphErrorReturn(creativeError);

        const successCount = createdAds.length;
        const failedCount = creatives.length - successCount;
        const message =
          successCount > 0
            ? `Conjunto criado com ${successCount} anúncio(s). ${failedCount} anúncio(s) falharam: ${creativeErrorReturn.reason.message}`
            : `Conjunto de anúncios criado, mas os anúncios falharam: ${creativeErrorReturn.reason.message}`;

        return NextResponse.json(
          {
            success: false,
            adsetId,
            adsetName: adsetName.trim(),
            ads: createdAds,
            adCreatives: createdAdCreatives,
            adId: createdAds[0]?.id,
            adCreativeId: createdAdCreatives[0]?.id,
            error: creativeErrorReturn.reason.title,
            message,
            solution:
              "O conjunto foi criado com sucesso. Adicione os anúncios faltantes manualmente pelo Meta Ads Manager.",
          } as PostAdSetResponse & AdSetsErrorResponse,
          { status: 207 },
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        adsetId,
        adsetName: adsetName.trim(),
        ads: createdAds,
        adCreatives: createdAdCreatives,
        adId: createdAds[0]?.id,
        adCreativeId: createdAdCreatives[0]?.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("[POST /adsets] Error:", errorReturn);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<PatchAdSetResponse | AdSetsErrorResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 }
      );
    }

    const { accountId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 }
      );
    }

    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode }
      );
    }

    const { accessToken } = tokenResult;
    const body: PatchAdSetRequestBody = await request.json();
    const { adsetId, status } = body;

    if (!adsetId || !status) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "adsetId and status are required",
          solution: "Provide both adsetId and status in the request body",
        },
        { status: 400 }
      );
    }

    const updateParams = new URLSearchParams({ status });

    await metaApiCall<GraphApiUpdateAdSetResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${adsetId}`,
      params: "",
      body: updateParams,
      accessToken,
    });

    return NextResponse.json(
      {
        success: true,
        adset: {
          id: adsetId,
          status,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error updating adset:", errorReturn);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode }
    );
  }
}
