import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { createCampaignEditLog } from "@/lib/db/admin-queries";
import {
  type CampaignAdSetBudgetInput,
  type CampaignBudgetMode,
  CampaignStatus,
  type Campaign,
  type DatePreset,
  type GraphApiAdSet,
  type GraphApiCampaign,
  type GraphPaging,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  transformCampaign,
  transformPaging,
} from "@/lib/meta-business/transformers";

// ================================
// Graph API Response Types
// ================================

type GraphApiCampaignsResponse = {
  data: GraphApiCampaign[];
  paging?: GraphPaging;
};

type GraphApiAdSetsResponse = {
  data: GraphApiAdSet[];
  paging?: GraphPaging;
};

type GraphApiUpdateCampaignResponse = {
  success: boolean;
};

// ================================
// Route Types
// ================================

export type GetCampaignsQueryParams = {
  limit?: string;
  after?: string;
  before?: string;
  datePreset?: DatePreset;
  since?: string;
  until?: string;
  effectiveStatus?: string;
  userId: string; // Required: identifies which user's token to use
};

export type GetCampaignsResponse = Partial<{
  data: Campaign[];
  pagination: PaginationInfo;
}>;

type PatchCampaignStatusRequestBody = {
  campaignId: string;
  status: CampaignStatus;
};

type PatchCampaignBudgetModeRequestBody = {
  campaignId: string;
  campaignName?: string;
  mode: CampaignBudgetMode;
  dailyBudget?: number;
  adsetBudgets?: CampaignAdSetBudgetInput[];
  note: string;
};

export type PatchCampaignRequestBody =
  | PatchCampaignStatusRequestBody
  | PatchCampaignBudgetModeRequestBody;

export type PatchCampaignResponse = {
  success: boolean;
  logId?: string;
  /** True when Meta applied but DB audit log insert failed */
  auditLogFailed?: boolean;
  auditLogError?: string;
  campaign?: {
    id: string;
    name?: string;
    status?: CampaignStatus;
    dailyBudget?: string;
    lifetimeBudget?: string;
    budgetMode?: CampaignBudgetMode;
    usesCampaignBudget?: boolean;
  };
};

export type CampaignsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

// ================================
// Helper Functions
// ================================

/**
 * Build the fields parameter for campaigns query.
 */
function buildCampaignFields(): string {
  const insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,action_values,purchase_roas,website_purchase_roas,date_start,date_stop}";

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "objective",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "is_adset_budget_sharing_enabled",
    "start_time",
    "stop_time",
    "created_time",
    "updated_time",
    insightsFields,
  ].join(",");
}

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function toMinorUnits(value: number): string {
  return Math.round(value * 100).toString();
}

function isPositiveBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

function isStatusPatchBody(
  body: PatchCampaignRequestBody,
): body is PatchCampaignStatusRequestBody {
  return "status" in body;
}

// ================================
// Route Handlers
// ================================

/**
 * GET /api/meta-marketing/[accountId]/campaigns
 *
 * Fetches campaigns from a Meta ad account with inline insights.
 * Requires admin authentication and userId query parameter.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetCampaignsResponse | CampaignsErrorResponse>> {
  try {
    // Verify admin authentication
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

    // Parse query parameters
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

    // Get user's access token from database
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
    const effectiveStatus = searchParams.get("effectiveStatus");

    // Validate and set limit (default: 25, max: 100)
    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    // Build fields parameter
    const fields = buildCampaignFields();

    // Build query params
    const queryParams: string[] = [`fields=${fields}`, `limit=${limit}`];

    if (after) {
      queryParams.push(`after=${after}`);
    }
    if (before) {
      queryParams.push(`before=${before}`);
    }

    // Add effective_status filter if provided
    if (effectiveStatus) {
      const statusArray = effectiveStatus.split(",").map((s) => s.trim());
      queryParams.push(
        `effective_status=${encodeURIComponent(JSON.stringify(statusArray))}`
      );
    }

    // Ensure account ID has act_ prefix
    const formattedAccountId = formatAccountId(accountId);

    // Make Graph API request
    const response = await metaApiCall<GraphApiCampaignsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formattedAccountId}/campaigns`,
      params: queryParams.join("&"),
      accessToken,
    });

    // Transform response to camelCase
    const campaigns = response.data.map(transformCampaign);
    const pagination = transformPaging(response.paging);

    return NextResponse.json(
      {
        data: campaigns,
        pagination,
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);

    console.error("Error fetching campaigns:", errorReturn);

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

/**
 * PATCH /api/meta-marketing/[accountId]/campaigns
 *
 * Updates a campaign's status (enable/disable).
 * Requires admin authentication and userId query parameter.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<PatchCampaignResponse | CampaignsErrorResponse>> {
  try {
    // Verify admin authentication
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

    // Parse query parameters
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

    // Get user's access token from database
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

    const body: PatchCampaignRequestBody = await request.json();

    if (isStatusPatchBody(body)) {
      const { campaignId, status } = body;

      if (!campaignId || !status) {
        return NextResponse.json(
          {
            error: "Invalid request",
            message: "campaignId and status are required",
            solution: "Provide both campaignId and status in the request body",
          },
          { status: 400 }
        );
      }

      const updateParams = new URLSearchParams({
        status,
      });

      await metaApiCall<GraphApiUpdateCampaignResponse>({
        domain: "FACEBOOK",
        method: "POST",
        path: `${campaignId}`,
        params: "",
        body: updateParams,
        accessToken,
      });

      return NextResponse.json(
        {
          success: true,
          campaign: {
            id: campaignId,
            status,
          },
        },
        { status: 200 }
      );
    }

    const { campaignId, campaignName, mode, dailyBudget, adsetBudgets, note } =
      body;

    if (!campaignId || !mode) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "campaignId and mode are required",
          solution: "Provide both campaignId and mode in the request body",
        },
        { status: 400 }
      );
    }

    if (!note?.trim()) {
      return NextResponse.json(
        {
          error: "Missing note",
          message: "A note explaining the change is required",
          solution: "Provide a note to explain why this change is being made",
        },
        { status: 400 }
      );
    }

    const backofficeUserEmail = session.user.email?.trim();
    if (!backofficeUserEmail) {
      return NextResponse.json(
        {
          error: "Missing admin email",
          message: "Sua sessão não possui email. Faça login novamente.",
          solution: "Encerre a sessão e entre novamente com Google.",
        },
        { status: 400 }
      );
    }

    const currentCampaign = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params:
        "fields=id,name,daily_budget,lifetime_budget,is_adset_budget_sharing_enabled",
      accessToken,
    });

    const previousBudgetMode: CampaignBudgetMode =
      currentCampaign.daily_budget || currentCampaign.lifetime_budget
        ? "CBO"
        : "ABO";
    const previousDailyBudget = currentCampaign.daily_budget ?? null;

    const updateParams = new URLSearchParams();
    let adsetBudgetChanges:
      | Array<{
          adsetId: string;
          adsetName?: string;
          previousDailyBudget?: string | null;
          newDailyBudget: string;
        }>
      | undefined;

    if (mode === "CBO") {
      if (!isPositiveBudget(dailyBudget)) {
        return NextResponse.json(
          {
            error: "Invalid daily budget",
            message: "Informe um orçamento diário válido de pelo menos R$ 1,00",
            solution: "Defina o orçamento diário da campanha em reais",
          },
          { status: 400 }
        );
      }

      updateParams.set("daily_budget", toMinorUnits(dailyBudget));
    } else {
      if (!adsetBudgets?.length) {
        return NextResponse.json(
          {
            error: "Missing ad set budgets",
            message:
              "Para usar ABO, informe o orçamento diário de todos os conjuntos de anúncios.",
            solution:
              "Preencha o orçamento diário individual de cada conjunto de anúncios.",
          },
          { status: 400 }
        );
      }

      const adSetsResponse = await metaApiCall<GraphApiAdSetsResponse>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${formatAccountId(accountId)}/adsets`,
        params: [
          "fields=id,name,daily_budget",
          "limit=100",
          `filtering=${encodeURIComponent(
            JSON.stringify([
              {
                field: "campaign.id",
                operator: "EQUAL",
                value: campaignId,
              },
            ]),
          )}`,
        ].join("&"),
        accessToken,
      });

      if (adSetsResponse.data.length === 0) {
        return NextResponse.json(
          {
            error: "No ad sets found",
            message:
              "Esta campanha não possui conjuntos de anúncios para configurar em ABO.",
            solution: "Crie pelo menos um conjunto de anúncios antes de mudar para ABO.",
          },
          { status: 400 }
        );
      }

      if (adSetsResponse.data.length > 70) {
        return NextResponse.json(
          {
            error: "Too many ad sets",
            message:
              "Campanhas com mais de 70 conjuntos de anúncios não podem desativar CBO via Meta.",
            solution:
              "Reduza a quantidade de conjuntos de anúncios ou mantenha a campanha em CBO.",
          },
          { status: 400 }
        );
      }

      const inputBudgetMap = new Map<string, CampaignAdSetBudgetInput>();
      for (const adsetBudget of adsetBudgets) {
        if (!adsetBudget?.adsetId || inputBudgetMap.has(adsetBudget.adsetId)) {
          return NextResponse.json(
            {
              error: "Invalid ad set budgets",
              message:
                "Os orçamentos dos conjuntos de anúncios possuem itens duplicados ou inválidos.",
              solution:
                "Revise a lista e informe um orçamento diário único para cada conjunto.",
            },
            { status: 400 }
          );
        }

        if (!isPositiveBudget(adsetBudget.dailyBudget)) {
          return NextResponse.json(
            {
              error: "Invalid ad set budget",
              message:
                "Cada conjunto de anúncios precisa de um orçamento diário de pelo menos R$ 1,00.",
              solution:
                "Ajuste os valores individuais antes de salvar a mudança para ABO.",
            },
            { status: 400 }
          );
        }

        inputBudgetMap.set(adsetBudget.adsetId, adsetBudget);
      }

      const missingAdSets = adSetsResponse.data.filter(
        (adSet) => !inputBudgetMap.has(adSet.id),
      );
      if (missingAdSets.length > 0 || inputBudgetMap.size !== adSetsResponse.data.length) {
        return NextResponse.json(
          {
            error: "Incomplete ad set budgets",
            message:
              "Para usar ABO, é obrigatório definir o orçamento diário de todos os conjuntos da campanha.",
            solution:
              "Preencha todos os conjuntos exibidos antes de salvar a alteração.",
          },
          { status: 400 }
        );
      }

      adsetBudgetChanges = adSetsResponse.data.map((adSet) => {
        const input = inputBudgetMap.get(adSet.id)!;
        return {
          adsetId: adSet.id,
          adsetName: adSet.name ?? input.adsetName,
          previousDailyBudget: adSet.daily_budget ?? null,
          newDailyBudget: toMinorUnits(input.dailyBudget),
        };
      });

      updateParams.set(
        "adset_budgets",
        JSON.stringify(
          adsetBudgetChanges.map((adSet) => ({
            adset_id: adSet.adsetId,
            daily_budget: Number(adSet.newDailyBudget),
          })),
        ),
      );
    }

    let appliedToMeta = false;
    let errorMessage: string | undefined;

    try {
      await metaApiCall<GraphApiUpdateCampaignResponse>({
        domain: "FACEBOOK",
        method: "POST",
        path: `${campaignId}`,
        params: "",
        body: updateParams,
        accessToken,
      });
      appliedToMeta = true;
    } catch (metaError) {
      const errorReturn = errorToGraphErrorReturn(metaError);
      errorMessage = `${errorReturn.reason.title}: ${errorReturn.reason.message}`;
    }

    let logId: string | undefined;
    let auditLogFailed = false;
    let auditLogError: string | undefined;

    try {
      const log = await createCampaignEditLog({
        backofficeUserEmail,
        targetUserId: userId,
        campaignId,
        accountId: formatAccountId(accountId),
        campaignName: campaignName ?? currentCampaign.name,
        previousBudgetMode,
        newBudgetMode: mode,
        previousDailyBudget,
        newDailyBudget:
          mode === "CBO" && isPositiveBudget(dailyBudget)
            ? toMinorUnits(dailyBudget)
            : undefined,
        adsetBudgetChanges,
        note: note.trim(),
        appliedToMeta,
        errorMessage,
      });
      logId = log.id;
    } catch (dbErr) {
      console.error(
        "[PATCH campaign] Failed to write campaign_edit_logs:",
        dbErr,
      );
      auditLogFailed = true;
      auditLogError =
        dbErr instanceof Error ? dbErr.message : "Falha ao registrar auditoria";
    }

    if (!appliedToMeta) {
      return NextResponse.json(
        {
          error: "Failed to apply changes to Meta",
          message: errorMessage ?? "Unknown error occurred",
          solution:
            "A alteração foi registrada, mas não foi aplicada na Meta. Tente novamente.",
        },
        { status: 400 }
      );
    }

    const updatedCampaignGraph = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params: `fields=${buildCampaignFields()}`,
      accessToken,
    });
    const updatedCampaign = transformCampaign(updatedCampaignGraph);

    return NextResponse.json(
      {
        success: true,
        logId,
        auditLogFailed,
        auditLogError,
        campaign: {
          id: updatedCampaign.id,
          name: updatedCampaign.name,
          status: updatedCampaign.status,
          dailyBudget: updatedCampaign.dailyBudget,
          lifetimeBudget: updatedCampaign.lifetimeBudget,
          budgetMode: updatedCampaign.budgetMode,
          usesCampaignBudget: updatedCampaign.usesCampaignBudget,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);

    console.error("Error updating campaign:", errorReturn);

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
