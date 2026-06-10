import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { logMetaMutationError } from "@/lib/observability/meta-logger";
import { attachCorrelationId } from "@/lib/observability/with-meta-logging";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
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
import type { GeoLocationsPayload } from "@/lib/meta-business/geo-targeting-types";
import type { InterestTargetingValue } from "@/lib/meta-business/interest-targeting-types";
import type {
  CampaignDeliveryMode,
  CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import { createAdSetInExistingCampaign } from "@/lib/meta-business/marketing/create-adset-in-existing-campaign";
import type { PlacementKey } from "@/lib/meta-business/placements";

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

function buildAdSetFields(options?: {
  datePreset?: string | null;
  since?: string | null;
  until?: string | null;
}): string {
  let insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,cost_per_result,action_values,purchase_roas,website_purchase_roas,date_start,date_stop}";

  const insightsParams: string[] = [];
  if (options?.datePreset) {
    insightsParams.push(`date_preset(${options.datePreset})`);
  } else if (options?.since && options?.until) {
    insightsParams.push(
      `time_range({'since':'${options.since}','until':'${options.until}'})`,
    );
  }

  if (insightsParams.length > 0) {
    insightsFields = `insights.${insightsParams.join(
      ".",
    )}{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,cost_per_result,action_values,purchase_roas,website_purchase_roas,date_start,date_stop}`;
  }

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
    "is_dynamic_creative",
    "targeting",
    "issues_info{error_code,error_message,error_summary,error_type,level,mid}",
    // Roll-up: detect ad issues without bloating payload — `effective_status`
    // alone is enough to count WITH_ISSUES / DISAPPROVED descendants.
    "ads.limit(200){id,effective_status}",
    insightsFields,
  ].join(",");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetAdSetsResponse | AdSetsErrorResponse>> {
  try {
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

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
    });

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
    const datePreset = searchParams.get("datePreset");
    const since = searchParams.get("since");
    const until = searchParams.get("until");

    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    const fields = buildAdSetFields({ datePreset, since, until });
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

type CreateAdCreativeApiResponse = { id: string };
type CreateAdApiResponse = { id: string };
type MediaBoostEligibilityResponse = {
  id: string;
  boost_eligibility_info?: {
    eligible_to_boost: boolean;
    ineligible_reason?: string;
  };
};

export type PostAdSetRequestBody = {
  userId: string;
  campaignId: string;
  /** Used by backoffice-only ad/creative layer (CTA mapping). */
  campaignObjective?: string;
  pageId?: string;
  pixelId?: string;
  adsetName: string;
  /** @deprecated Prefer budgetType + budgetValue */
  dailyBudget?: number;
  budgetType?: "daily" | "lifetime";
  budgetValue?: number;
  startTime?: string;
  endTime?: string;
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
  targeting: {
    age_min: number;
    age_max: number;
    genders?: number[];
    custom_audiences?: { id: string; name?: string }[];
    excluded_custom_audiences?: { id: string; name?: string }[];
    interest_targeting?: InterestTargetingValue;
    placements?: PlacementKey[];
    geo_locations?: GeoLocationsPayload;
  };
  /** @deprecated Use `creatives` instead */
  creative?: {
    instagramMediaId: string;
  };
  creatives?: Array<{
    instagramMediaId: string;
  }>;
  /** URL for SALES campaigns when creatives are provided */
  url?: string;
  /** @deprecated Prefer targeting.geo_locations */
  geoLocations?: GeoLocationsPayload;
};

export type PostAdSetResponse = {
  success: boolean;
  adsetId: string;
  adsetName: string;
  adset?: AdSet;
  adId?: string;
  adCreativeId?: string;
  ads?: Array<{ id: string; creativeId: string }>;
  adCreatives?: Array<{ id: string }>;
};

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
    logMetaMutationError(error);
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

async function checkMediaBoostEligibility(
  mediaId: string,
  accessToken: string,
): Promise<{ isEligible: boolean; ineligibleReason?: string }> {
  const response = await metaApiCall<MediaBoostEligibilityResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: mediaId,
    params: "fields=id,boost_eligibility_info",
    accessToken,
  });

  return {
    isEligible: response.boost_eligibility_info?.eligible_to_boost === true,
    ineligibleReason: response.boost_eligibility_info?.ineligible_reason,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<PostAdSetResponse | AdSetsErrorResponse>> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/adsets",
    operationHint: "create",
    entityHint: "adset",
  });
  try {
    const { accountId } = await params;
    const body: PostAdSetRequestBody = await request.json();
    const {
      userId,
      campaignId,
      campaignObjective,
      pageId: requestedPageId,
      pixelId,
      adsetName,
      dailyBudget,
      budgetType: bodyBudgetType,
      budgetValue: bodyBudgetValue,
      startTime,
      endTime,
      deliveryMode,
      scheduleBlocks,
      targeting,
      creative,
      creatives: rawCreatives,
      url,
      geoLocations,
    } = body;

    const budgetType =
      bodyBudgetType ?? (dailyBudget !== undefined ? "daily" : undefined);
    const budgetValue =
      bodyBudgetValue ?? dailyBudget;

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

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:write",
    );
    if (!authz.ok) return authz.response;

    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
    });

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

    for (const source of creatives) {
      try {
        const eligibility = await checkMediaBoostEligibility(
          source.instagramMediaId,
          accessToken,
        );

        if (!eligibility.isEligible) {
          return NextResponse.json(
            {
              error: "Mídia não elegível",
              message:
                "Esta publicação do Instagram não pode ser anunciada no momento.",
              solution:
                eligibility.ineligibleReason ??
                "Escolha outra publicação elegível para anúncio.",
            },
            { status: 400 },
          );
        }
      } catch (error) {
        logMetaMutationError(error);
    console.error("Error checking Instagram media boost eligibility:", error);
        return NextResponse.json(
          {
            error: "Falha ao validar mídia",
            message:
              "Não foi possível confirmar se uma publicação do Instagram pode ser anunciada.",
            solution: "Tente novamente ou selecione outra publicação.",
          },
          { status: 400 },
        );
      }
    }

    const geoLocationsPayload =
      targeting.geo_locations ?? geoLocations ?? undefined;

    const createResult = await createAdSetInExistingCampaign({
      accountId,
      accessToken,
      campaignId,
      adsetName: adsetName.trim(),
      pageId: requestedPageId,
      pixelId,
      budgetType,
      budgetValue,
      startTime,
      endTime,
      deliveryMode,
      scheduleBlocks,
      targeting: {
        age_min: targeting.age_min,
        age_max: targeting.age_max,
        genders: targeting.genders,
        geo_locations: geoLocationsPayload,
        custom_audiences: targeting.custom_audiences,
        excluded_custom_audiences: targeting.excluded_custom_audiences,
        interest_targeting: targeting.interest_targeting,
        placements: targeting.placements,
      },
    });

    if (!createResult.ok) {
      return NextResponse.json(
        {
          error: createResult.error.error,
          message: createResult.error.message,
          solution: createResult.error.solution,
        },
        { status: createResult.error.statusCode },
      );
    }

    const adsetId = createResult.value.adsetId;
    const transformedAdSet = transformAdSet(createResult.value.graphAdSet);

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const pagesResponse = await metaApiCall<GraphApiPagesResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: "me/accounts",
      params: "fields=id,name,instagram_business_account{id,username}",
      accessToken,
    });

    const connectedPage = requestedPageId?.trim()
      ? pagesResponse.data.find((p) => p.id === requestedPageId.trim())
      : (pagesResponse.data.find((p) => p.instagram_business_account?.id) ??
        pagesResponse.data[0]);

    const pageWithIg = connectedPage?.instagram_business_account?.id
      ? connectedPage
      : undefined;
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
      attachCorrelationId({
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
          } as PostAdSetResponse & AdSetsErrorResponse),
          { status: 207 },
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        adsetId,
        adsetName: adsetName.trim(),
        adset: transformedAdSet,
        ads: createdAds,
        adCreatives: createdAdCreatives,
        adId: createdAds[0]?.id,
        adCreativeId: createdAdCreatives[0]?.id,
      },
      { status: 201 },
    );
  } catch (error) {
    logMetaMutationError(error);
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
  enterMetaMutationLog({
    app: "backoffice",
    route: "PATCH /api/meta-marketing/{accountId}/adsets",
    operationHint: "update",
    entityHint: "adset",
  });
  try {
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

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:write",
    );
    if (!authz.ok) return authz.response;

    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
    });

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
