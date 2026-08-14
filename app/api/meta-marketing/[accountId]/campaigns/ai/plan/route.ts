import { NextRequest, NextResponse } from "next/server";
import { getPrimaryCompanyForUser } from "@/lib/db/admin-queries";
import { fetchAccountContext } from "@/lib/meta-business/insights";
import {
  MoldNotFoundError,
  planDuplicatedCampaign,
  type DuplicationPlanResult,
  type MoldRef,
  type PlanAnswers,
} from "@/lib/meta-business/marketing/ai-creation";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

export type PlanCampaignRequest = {
  mold: MoldRef;
  answers: PlanAnswers;
};

export type PlanCampaignResponse = { success: true } & DuplicationPlanResult;

export type PlanCampaignErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/plan?userId=
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<PlanCampaignResponse | PlanCampaignErrorResponse>> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(request, accountIdParam, "plan");
    if (!auth.ok) {
      return auth.response as NextResponse<
        PlanCampaignResponse | PlanCampaignErrorResponse
      >;
    }

    const body = (await request.json()) as Partial<PlanCampaignRequest>;
    if (!body.mold?.adSetId || !body.answers) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid request",
          message: "Informe o molde e as respostas do fluxo.",
        },
        { status: 400 },
      );
    }

    const [account, company] = await Promise.all([
      fetchAccountContext({
        adAccountId: auth.accountId,
        accessToken: auth.accessToken,
      }),
      getPrimaryCompanyForUser(auth.userId),
    ]);

    const plan = await planDuplicatedCampaign(
      {
        adAccountId: auth.accountId,
        accessToken: auth.accessToken,
        currency: account.currency,
        timezoneName: account.timezoneName,
      },
      body.mold,
      { ...body.answers, niche: company?.niche ?? null },
      { minDailyBudgetCents: account.minDailyBudgetCents },
    );

    return NextResponse.json({ success: true, ...plan });
  } catch (error) {
    if (error instanceof MoldNotFoundError) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Mold not found",
          message: error.message,
          solution: "Volte e refaça a análise da conta.",
        },
        { status: 404 },
      );
    }
    if (isTokenInvalidError(error)) return tokenInvalidJson();

    console.error("[ai/plan] failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: "Plan failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível montar a campanha.",
        solution: "Tente novamente em alguns instantes.",
      },
      { status: 500 },
    );
  }
}
