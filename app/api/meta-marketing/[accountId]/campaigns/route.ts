import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { createCampaignEditLog } from "@/lib/db/admin-queries";
import {
  currencyToMinorUnits,
  isEndAfterStart,
  isValidDateTimeLocal,
  type BudgetType,
} from "@/lib/meta-business/budget-schedule";
import {
  type CampaignAdSetBudgetInput,
  type CampaignAdSetScheduleChange,
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
  budgetType?: BudgetType;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime?: string;
  endTime?: string;
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
    startTime?: string;
    stopTime?: string;
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
    "issues_info{error_code,error_message,error_summary,error_type,level,mid}",
    // Roll-up: pick only `effective_status` from descendants to detect issues
    // without bloating the payload. The 200 cap is a safety net — typical
    // campaigns have well under 70 ad sets (Meta's ABO limit).
    "adsets.limit(200){id,effective_status}",
    "ads.limit(200){id,effective_status}",
    insightsFields,
  ].join(",");
}

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function isPositiveBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

function parsePositiveMinorUnits(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasPositiveMinorUnits(value: string | null | undefined): boolean {
  return parsePositiveMinorUnits(value) !== null;
}

function getAdSetBudgetType(adSet: GraphApiAdSet): BudgetType | null {
  if (hasPositiveMinorUnits(adSet.daily_budget)) return "daily";
  if (hasPositiveMinorUnits(adSet.lifetime_budget)) return "lifetime";
  return null;
}

function toMinuteTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setSeconds(0, 0);
  return date.getTime();
}

function hasScheduleMinuteChange(
  currentValue: string | null | undefined,
  nextValue: string,
): boolean {
  const currentTimestamp = toMinuteTimestamp(currentValue);
  const nextTimestamp = toMinuteTimestamp(nextValue);
  return nextTimestamp !== null && currentTimestamp !== nextTimestamp;
}

function hasStarted(startTime: string | null | undefined): boolean {
  const timestamp = toMinuteTimestamp(startTime);
  return timestamp !== null && timestamp <= Date.now();
}

function buildScheduleUpdateParams(
  adSet: GraphApiAdSet,
  nextStartTime: string,
  nextEndTime: string,
): URLSearchParams | { error: string } {
  const params = new URLSearchParams();
  const startChanged = hasScheduleMinuteChange(adSet.start_time, nextStartTime);
  const endChanged = hasScheduleMinuteChange(adSet.end_time, nextEndTime);

  if (startChanged) {
    if (hasStarted(adSet.start_time)) {
      return {
        error:
          "A data de início não pode ser alterada em conjuntos que já começaram. Altere apenas a data de término.",
      };
    }

    params.set("start_time", new Date(nextStartTime).toISOString());
  }

  if (endChanged) {
    params.set("end_time", new Date(nextEndTime).toISOString());
  }

  return params;
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
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetCampaignsResponse | CampaignsErrorResponse>> {
  try {
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
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    // Get user's access token from database
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
        `effective_status=${encodeURIComponent(JSON.stringify(statusArray))}`,
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
      { status: 200 },
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
      { status: errorReturn.statusCode },
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
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<PatchCampaignResponse | CampaignsErrorResponse>> {
  try {
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
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:write",
    );
    if (!authz.ok) return authz.response;

    // Get user's access token from database
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

    const body: PatchCampaignRequestBody = await request.json();
    console.log("TODELETE - [PATCH campaigns] request body", {
      accountId,
      userId,
      body,
    });

    if (isStatusPatchBody(body)) {
      const { campaignId, status } = body;

      if (!campaignId || !status) {
        console.log("TODELETE - [PATCH campaigns] invalid status body", {
          campaignId,
          status,
        });
        return NextResponse.json(
          {
            error: "Invalid request",
            message: "campaignId and status are required",
            solution: "Provide both campaignId and status in the request body",
          },
          { status: 400 },
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
        { status: 200 },
      );
    }

    const {
      campaignId,
      campaignName,
      mode,
      budgetType,
      dailyBudget,
      lifetimeBudget,
      startTime,
      endTime,
      adsetBudgets,
      note,
    } = body;

    if (!campaignId || !mode) {
      console.log("TODELETE - [PATCH campaigns] missing campaignId/mode", {
        campaignId,
        mode,
      });
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "campaignId and mode are required",
          solution: "Provide both campaignId and mode in the request body",
        },
        { status: 400 },
      );
    }

    if (!note?.trim()) {
      console.log("TODELETE - [PATCH campaigns] missing note", {
        campaignId,
        mode,
      });
      return NextResponse.json(
        {
          error: "Missing note",
          message: "A note explaining the change is required",
          solution: "Provide a note to explain why this change is being made",
        },
        { status: 400 },
      );
    }

    const backofficeUserEmail = authz.actor.email;

    const currentCampaign = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params:
        "fields=id,name,daily_budget,lifetime_budget,start_time,stop_time,is_adset_budget_sharing_enabled",
      accessToken,
    });

    const previousBudgetMode: CampaignBudgetMode =
      hasPositiveMinorUnits(currentCampaign.daily_budget) ||
      hasPositiveMinorUnits(currentCampaign.lifetime_budget)
        ? "CBO"
        : "ABO";
    const previousDailyBudget = currentCampaign.daily_budget ?? null;
    const previousLifetimeBudget = currentCampaign.lifetime_budget ?? null;
    console.log("TODELETE - [PATCH campaigns] current Meta campaign", {
      campaignId,
      previousBudgetMode,
      previousDailyBudget,
      previousLifetimeBudget,
      startTime: currentCampaign.start_time,
      stopTime: currentCampaign.stop_time,
      requestedMode: mode,
      requestedBudgetType: budgetType,
    });

    const updateParams = new URLSearchParams();
    let adsetBudgetChanges:
      | Array<{
          adsetId: string;
          adsetName?: string;
          previousDailyBudget?: string | null;
          newDailyBudget?: string | null;
          previousLifetimeBudget?: string | null;
          newLifetimeBudget?: string | null;
        }>
      | undefined;
    let adsetScheduleChanges: CampaignAdSetScheduleChange[] | undefined;
    const adSetUpdateOperations: Array<{
      adsetId: string;
      params: URLSearchParams;
    }> = [];

    const loadCampaignAdSets = async () =>
      metaApiCall<GraphApiAdSetsResponse>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${formatAccountId(accountId)}/adsets`,
        params: [
          "fields=id,name,daily_budget,lifetime_budget,start_time,end_time",
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

    if (mode === "CBO") {
      const selectedBudgetType: BudgetType =
        budgetType ??
        (hasPositiveMinorUnits(currentCampaign.lifetime_budget)
          ? "lifetime"
          : "daily");
      console.log("TODELETE - [PATCH campaigns] CBO branch", {
        campaignId,
        selectedBudgetType,
        dailyBudget,
        lifetimeBudget,
        startTime,
        endTime,
      });

      if (selectedBudgetType === "daily") {
        if (!isPositiveBudget(dailyBudget)) {
          console.log("TODELETE - [PATCH campaigns] invalid CBO daily budget", {
            campaignId,
            dailyBudget,
          });
          return NextResponse.json(
            {
              error: "Invalid daily budget",
              message:
                "Informe um orçamento diário válido de pelo menos R$ 1,00",
              solution: "Defina o orçamento diário da campanha em reais",
            },
            { status: 400 },
          );
        }

        const nextDailyBudget = currencyToMinorUnits(dailyBudget);
        if (
          previousBudgetMode === "ABO" ||
          previousDailyBudget !== nextDailyBudget
        ) {
          updateParams.set("daily_budget", nextDailyBudget);
        }

        if (previousBudgetMode === "ABO") {
          const adSetsResponse = await loadCampaignAdSets();
          console.log("TODELETE - [PATCH campaigns] ABO to CBO adsets loaded", {
            campaignId,
            selectedBudgetType,
            adsetCount: adSetsResponse.data.length,
            adsets: adSetsResponse.data.map((adSet) => ({
              id: adSet.id,
              name: adSet.name,
              dailyBudget: adSet.daily_budget,
              lifetimeBudget: adSet.lifetime_budget,
            })),
          });

          if (adSetsResponse.data.length === 0) {
            console.log(
              "TODELETE - [PATCH campaigns] no adsets for ABO to CBO",
              { campaignId },
            );
            return NextResponse.json(
              {
                error: "No ad sets found",
                message:
                  "Esta campanha não possui conjuntos de anúncios para migrar para CBO.",
                solution:
                  "Crie pelo menos um conjunto de anúncios antes de mudar para CBO.",
              },
              { status: 400 },
            );
          }

          const lifetimeBudgetAdSets = adSetsResponse.data.filter(
            (adSet) => getAdSetBudgetType(adSet) === "lifetime",
          );
          if (lifetimeBudgetAdSets.length > 0) {
            console.log(
              "TODELETE - [PATCH campaigns] daily CBO blocked by lifetime ABO adsets",
              {
                campaignId,
                lifetimeBudgetAdSets: lifetimeBudgetAdSets.map((adSet) => ({
                  id: adSet.id,
                  name: adSet.name,
                  lifetimeBudget: adSet.lifetime_budget,
                  startTime: adSet.start_time,
                  endTime: adSet.end_time,
                })),
              },
            );
            return NextResponse.json(
              {
                error: "Incompatible budget type",
                message:
                  "Esta campanha está configurada com orçamento total nos conjuntos de anúncios. Para migrar para CBO, use orçamento total na campanha.",
                solution:
                  "Selecione orçamento total e informe o período da campanha antes de salvar.",
              },
              { status: 400 },
            );
          }
        }
      } else {
        if (!isPositiveBudget(lifetimeBudget)) {
          console.log(
            "TODELETE - [PATCH campaigns] invalid CBO lifetime budget",
            {
              campaignId,
              lifetimeBudget,
            },
          );
          return NextResponse.json(
            {
              error: "Invalid lifetime budget",
              message:
                "Informe um orçamento total válido de pelo menos R$ 1,00",
              solution: "Defina o orçamento total da campanha em reais",
            },
            { status: 400 },
          );
        }

        if (
          !startTime ||
          !endTime ||
          !isValidDateTimeLocal(startTime) ||
          !isValidDateTimeLocal(endTime) ||
          !isEndAfterStart(startTime, endTime)
        ) {
          console.log("TODELETE - [PATCH campaigns] invalid CBO schedule", {
            campaignId,
            startTime,
            endTime,
            hasStartTime: Boolean(startTime),
            hasEndTime: Boolean(endTime),
            startValid: startTime ? isValidDateTimeLocal(startTime) : false,
            endValid: endTime ? isValidDateTimeLocal(endTime) : false,
            endAfterStart:
              startTime && endTime ? isEndAfterStart(startTime, endTime) : false,
          });
          return NextResponse.json(
            {
              error: "Invalid schedule",
              message:
                "Para orçamento total, informe início e término válidos.",
              solution:
                "A data de término deve ser posterior à data de início.",
            },
            { status: 400 },
          );
        }

        const nextLifetimeBudget = currencyToMinorUnits(lifetimeBudget);
        if (
          previousBudgetMode === "ABO" ||
          previousLifetimeBudget !== nextLifetimeBudget
        ) {
          updateParams.set("lifetime_budget", nextLifetimeBudget);
        }

        const adSetsResponse = await loadCampaignAdSets();
        console.log("TODELETE - [PATCH campaigns] CBO lifetime adsets loaded", {
          campaignId,
          adsetCount: adSetsResponse.data.length,
          adsetIds: adSetsResponse.data.map((adSet) => adSet.id),
        });
        if (adSetsResponse.data.length === 0) {
          console.log("TODELETE - [PATCH campaigns] no adsets for CBO lifetime", {
            campaignId,
          });
          return NextResponse.json(
            {
              error: "No ad sets found",
              message:
                "Esta campanha não possui conjuntos de anúncios para aplicar o período.",
              solution:
                "Crie pelo menos um conjunto de anúncios antes de editar o período.",
            },
            { status: 400 },
          );
        }

        const newStartTime = new Date(startTime).toISOString();
        const newEndTime = new Date(endTime).toISOString();
        adsetScheduleChanges = adSetsResponse.data.map((adSet) => ({
          adsetId: adSet.id,
          adsetName: adSet.name,
          previousStartTime: adSet.start_time ?? null,
          newStartTime,
          previousEndTime: adSet.end_time ?? null,
          newEndTime,
        }));

        for (const adSet of adSetsResponse.data) {
          const scheduleParams = buildScheduleUpdateParams(
            adSet,
            newStartTime,
            newEndTime,
          );

          if ("error" in scheduleParams) {
            console.log(
              "TODELETE - [PATCH campaigns] invalid CBO adset start_time update",
              {
                campaignId,
                adsetId: adSet.id,
                currentStartTime: adSet.start_time,
                requestedStartTime: newStartTime,
                currentEndTime: adSet.end_time,
                requestedEndTime: newEndTime,
                error: scheduleParams.error,
              },
            );
            return NextResponse.json(
              {
                error: "Invalid schedule",
                message: scheduleParams.error,
                solution:
                  "Mantenha o início original e altere apenas o término da campanha.",
              },
              { status: 400 },
            );
          }

          if (scheduleParams.size > 0) {
            adSetUpdateOperations.push({
              adsetId: adSet.id,
              params: scheduleParams,
            });
          }
        }
      }
    } else {
      if (!adsetBudgets?.length) {
        console.log("TODELETE - [PATCH campaigns] missing ABO adset budgets", {
          campaignId,
          adsetBudgetsLength: adsetBudgets?.length ?? 0,
        });
        return NextResponse.json(
          {
            error: "Missing ad set budgets",
            message:
              "Para usar ABO, informe o orçamento de todos os conjuntos de anúncios.",
            solution:
              "Preencha o orçamento individual de cada conjunto de anúncios.",
          },
          { status: 400 },
        );
      }

      const adSetsResponse = await loadCampaignAdSets();
      console.log("TODELETE - [PATCH campaigns] ABO adsets loaded", {
        campaignId,
        adsetCount: adSetsResponse.data.length,
        requestedAdsetBudgetCount: adsetBudgets.length,
        adsetIds: adSetsResponse.data.map((adSet) => adSet.id),
      });

      if (adSetsResponse.data.length === 0) {
        console.log("TODELETE - [PATCH campaigns] no adsets for ABO", {
          campaignId,
        });
        return NextResponse.json(
          {
            error: "No ad sets found",
            message:
              "Esta campanha não possui conjuntos de anúncios para configurar em ABO.",
            solution:
              "Crie pelo menos um conjunto de anúncios antes de mudar para ABO.",
          },
          { status: 400 },
        );
      }

      if (adSetsResponse.data.length > 70) {
        console.log("TODELETE - [PATCH campaigns] too many adsets for ABO", {
          campaignId,
          adsetCount: adSetsResponse.data.length,
        });
        return NextResponse.json(
          {
            error: "Too many ad sets",
            message:
              "Campanhas com mais de 70 conjuntos de anúncios não podem desativar CBO via Meta.",
            solution:
              "Reduza a quantidade de conjuntos de anúncios ou mantenha a campanha em CBO.",
          },
          { status: 400 },
        );
      }

      const inputBudgetMap = new Map<string, CampaignAdSetBudgetInput>();
      for (const adsetBudget of adsetBudgets) {
        if (!adsetBudget?.adsetId || inputBudgetMap.has(adsetBudget.adsetId)) {
          console.log("TODELETE - [PATCH campaigns] invalid ABO adset item", {
            campaignId,
            adsetBudget,
            alreadySeen: adsetBudget?.adsetId
              ? inputBudgetMap.has(adsetBudget.adsetId)
              : false,
          });
          return NextResponse.json(
            {
              error: "Invalid ad set budgets",
              message:
                "Os orçamentos dos conjuntos de anúncios possuem itens duplicados ou inválidos.",
              solution:
                "Revise a lista e informe um orçamento diário único para cada conjunto.",
            },
            { status: 400 },
          );
        }

        const selectedBudgetType: BudgetType =
          adsetBudget.budgetType ??
          (adsetBudget.lifetimeBudget !== undefined ? "lifetime" : "daily");

        if (
          selectedBudgetType === "daily" &&
          !isPositiveBudget(adsetBudget.dailyBudget)
        ) {
          console.log("TODELETE - [PATCH campaigns] invalid ABO daily budget", {
            campaignId,
            adsetId: adsetBudget.adsetId,
            dailyBudget: adsetBudget.dailyBudget,
          });
          return NextResponse.json(
            {
              error: "Invalid ad set budget",
              message:
                "Cada conjunto de anúncios precisa de um orçamento diário de pelo menos R$ 1,00.",
              solution:
                "Ajuste os valores individuais antes de salvar a mudança para ABO.",
            },
            { status: 400 },
          );
        }

        if (
          selectedBudgetType === "lifetime" &&
          !isPositiveBudget(adsetBudget.lifetimeBudget)
        ) {
          console.log(
            "TODELETE - [PATCH campaigns] invalid ABO lifetime budget",
            {
              campaignId,
              adsetId: adsetBudget.adsetId,
              lifetimeBudget: adsetBudget.lifetimeBudget,
            },
          );
          return NextResponse.json(
            {
              error: "Invalid ad set budget",
              message:
                "Cada conjunto com orçamento total precisa de um valor de pelo menos R$ 1,00.",
              solution:
                "Ajuste os valores individuais antes de salvar a alteração para ABO.",
            },
            { status: 400 },
          );
        }

        if (selectedBudgetType === "lifetime") {
          const existingAdSet = adSetsResponse.data.find(
            (adSet) => adSet.id === adsetBudget.adsetId,
          );
          const nextStartTime = adsetBudget.startTime ?? existingAdSet?.start_time;
          const nextEndTime = adsetBudget.endTime ?? existingAdSet?.end_time;

          if (
            !nextStartTime ||
            !nextEndTime ||
            !isValidDateTimeLocal(nextStartTime) ||
            !isValidDateTimeLocal(nextEndTime) ||
            !isEndAfterStart(nextStartTime, nextEndTime)
          ) {
            console.log("TODELETE - [PATCH campaigns] invalid ABO schedule", {
              campaignId,
              adsetId: adsetBudget.adsetId,
              nextStartTime,
              nextEndTime,
              existingStartTime: existingAdSet?.start_time,
              existingEndTime: existingAdSet?.end_time,
              startValid: nextStartTime
                ? isValidDateTimeLocal(nextStartTime)
                : false,
              endValid: nextEndTime ? isValidDateTimeLocal(nextEndTime) : false,
              endAfterStart:
                nextStartTime && nextEndTime
                  ? isEndAfterStart(nextStartTime, nextEndTime)
                  : false,
            });
            return NextResponse.json(
              {
                error: "Invalid ad set schedule",
                message:
                  "Conjuntos com orçamento total precisam de início e término válidos.",
                solution:
                  "Revise as datas dos conjuntos com orçamento total.",
              },
              { status: 400 },
            );
          }
        }

        inputBudgetMap.set(adsetBudget.adsetId, adsetBudget);
      }

      const missingAdSets = adSetsResponse.data.filter(
        (adSet) => !inputBudgetMap.has(adSet.id),
      );
      if (
        missingAdSets.length > 0 ||
        inputBudgetMap.size !== adSetsResponse.data.length
      ) {
        console.log("TODELETE - [PATCH campaigns] incomplete ABO budgets", {
          campaignId,
          expectedAdsetCount: adSetsResponse.data.length,
          receivedAdsetCount: inputBudgetMap.size,
          missingAdSetIds: missingAdSets.map((adSet) => adSet.id),
        });
        return NextResponse.json(
          {
            error: "Incomplete ad set budgets",
            message:
              "Para usar ABO, é obrigatório definir o orçamento diário de todos os conjuntos da campanha.",
            solution:
              "Preencha todos os conjuntos exibidos antes de salvar a alteração.",
          },
          { status: 400 },
        );
      }

      adsetBudgetChanges = adSetsResponse.data.map((adSet) => {
        const input = inputBudgetMap.get(adSet.id)!;
        const inputBudgetType: BudgetType =
          input.budgetType ??
          (input.lifetimeBudget !== undefined ? "lifetime" : "daily");
        return {
          adsetId: adSet.id,
          adsetName: adSet.name ?? input.adsetName,
          previousDailyBudget: adSet.daily_budget ?? null,
          newDailyBudget:
            inputBudgetType === "daily" && input.dailyBudget !== undefined
              ? currencyToMinorUnits(input.dailyBudget)
              : null,
          previousLifetimeBudget: adSet.lifetime_budget ?? null,
          newLifetimeBudget:
            inputBudgetType === "lifetime" &&
            input.lifetimeBudget !== undefined
              ? currencyToMinorUnits(input.lifetimeBudget)
              : null,
        };
      });

      adsetScheduleChanges = [];
      for (const adSet of adSetsResponse.data) {
        const input = inputBudgetMap.get(adSet.id)!;
        const inputBudgetType: BudgetType =
          input.budgetType ??
          (input.lifetimeBudget !== undefined ? "lifetime" : "daily");

        if (inputBudgetType !== "lifetime") continue;

        const newStartTime = new Date(
          input.startTime ?? adSet.start_time!,
        ).toISOString();
        const newEndTime = new Date(
          input.endTime ?? adSet.end_time!,
        ).toISOString();

        adsetScheduleChanges.push({
          adsetId: adSet.id,
          adsetName: adSet.name ?? input.adsetName,
          previousStartTime: adSet.start_time ?? null,
          newStartTime,
          previousEndTime: adSet.end_time ?? null,
          newEndTime,
        });
      }

      if (previousBudgetMode === "CBO") {
        updateParams.set(
          "adset_budgets",
          JSON.stringify(
            adsetBudgetChanges.map((adSet) => ({
              adset_id: adSet.adsetId,
              ...(adSet.newDailyBudget && {
                daily_budget: Number(adSet.newDailyBudget),
              }),
              ...(adSet.newLifetimeBudget && {
                lifetime_budget: Number(adSet.newLifetimeBudget),
              }),
            })),
          ),
        );

        for (const adSet of adSetsResponse.data) {
          const input = inputBudgetMap.get(adSet.id)!;
          const inputBudgetType: BudgetType =
            input.budgetType ??
            (input.lifetimeBudget !== undefined ? "lifetime" : "daily");

          if (inputBudgetType !== "lifetime") continue;

          adSetUpdateOperations.push({
            adsetId: adSet.id,
            params: new URLSearchParams({
              start_time: new Date(
                input.startTime ?? adSet.start_time!,
              ).toISOString(),
              end_time: new Date(
                input.endTime ?? adSet.end_time!,
              ).toISOString(),
            }),
          });
        }
      } else {
        for (const adSet of adSetsResponse.data) {
          const input = inputBudgetMap.get(adSet.id)!;
          const inputBudgetType: BudgetType =
            input.budgetType ??
            (input.lifetimeBudget !== undefined ? "lifetime" : "daily");
          const params = new URLSearchParams();

          if (inputBudgetType === "daily" && input.dailyBudget !== undefined) {
            params.set("daily_budget", currencyToMinorUnits(input.dailyBudget));
          }

          if (
            inputBudgetType === "lifetime" &&
            input.lifetimeBudget !== undefined
          ) {
            params.set(
              "lifetime_budget",
              currencyToMinorUnits(input.lifetimeBudget),
            );
            params.set(
              "start_time",
              new Date(input.startTime ?? adSet.start_time!).toISOString(),
            );
            params.set(
              "end_time",
              new Date(input.endTime ?? adSet.end_time!).toISOString(),
            );
          }

          if (params.size > 0) {
            adSetUpdateOperations.push({ adsetId: adSet.id, params });
          }
        }
      }
    }

    let appliedToMeta = false;
    let errorMessage: string | undefined;
    let metaClientError:
      | {
          error: string;
          message: string;
          solution: string;
        }
      | undefined;

    try {
      console.log("TODELETE - [PATCH campaigns] applying Meta updates", {
        campaignId,
        campaignUpdateParams: Object.fromEntries(updateParams.entries()),
        adSetUpdateOperations: adSetUpdateOperations.map((operation) => ({
          adsetId: operation.adsetId,
          params: Object.fromEntries(operation.params.entries()),
        })),
      });
      if (updateParams.size > 0) {
        await metaApiCall<GraphApiUpdateCampaignResponse>({
          domain: "FACEBOOK",
          method: "POST",
          path: `${campaignId}`,
          params: "",
          body: updateParams,
          accessToken,
        });
      }

      for (const operation of adSetUpdateOperations) {
        console.log("TODELETE - [PATCH campaigns] applying adset update", {
          campaignId,
          adsetId: operation.adsetId,
          params: Object.fromEntries(operation.params.entries()),
        });
        await metaApiCall<{ success: boolean }>({
          domain: "FACEBOOK",
          method: "POST",
          path: operation.adsetId,
          params: "",
          body: operation.params,
          accessToken,
        });
      }
      appliedToMeta = true;
    } catch (metaError) {
      console.log("TODELETE - [PATCH campaigns] Meta update failed raw", {
        campaignId,
        metaError,
      });
      const errorReturn = errorToGraphErrorReturn(metaError);
      metaClientError = graphErrorToClientError(errorReturn);
      errorMessage = metaClientError.message;
      console.log("TODELETE - [PATCH campaigns] Meta update failed parsed", {
        campaignId,
        statusCode: errorReturn.statusCode,
        reason: errorReturn.reason,
        data: errorReturn.data,
      });
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
          mode === "CBO" &&
          (budgetType ??
            (hasPositiveMinorUnits(currentCampaign.lifetime_budget)
              ? "lifetime"
              : "daily")) ===
            "daily" &&
          isPositiveBudget(dailyBudget)
            ? currencyToMinorUnits(dailyBudget)
            : undefined,
        previousLifetimeBudget,
        newLifetimeBudget:
          mode === "CBO" &&
          (budgetType ??
            (hasPositiveMinorUnits(currentCampaign.lifetime_budget)
              ? "lifetime"
              : "daily")) ===
            "lifetime" &&
          isPositiveBudget(lifetimeBudget)
            ? currencyToMinorUnits(lifetimeBudget)
            : undefined,
        adsetBudgetChanges,
        adsetScheduleChanges:
          adsetScheduleChanges && adsetScheduleChanges.length > 0
            ? adsetScheduleChanges
            : undefined,
        note: note.trim(),
        appliedToMeta,
        errorMessage,
        source: "admin",
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
      console.log("TODELETE - [PATCH campaigns] returning Meta failure", {
        campaignId,
        errorMessage,
        auditLogFailed,
        auditLogError,
      });
      return NextResponse.json(
        {
          error: metaClientError?.error ?? "Failed to apply changes to Meta",
          message: metaClientError?.message ?? "Unknown error occurred",
          solution:
            metaClientError?.solution ??
            "A alteração foi registrada, mas não foi aplicada na Meta. Tente novamente.",
        },
        { status: 400 },
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
          startTime: updatedCampaign.startTime,
          stopTime: updatedCampaign.stopTime,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);

    console.error("Error updating campaign:", errorReturn);

    return NextResponse.json(
      {
        error: clientError.error,
        message: clientError.message,
        solution: clientError.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}
