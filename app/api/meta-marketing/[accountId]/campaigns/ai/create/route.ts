import { NextRequest, NextResponse } from "next/server";
import { getPrimaryCompanyForUser } from "@/lib/db/admin-queries";
import { fetchAccountContext } from "@/lib/meta-business/insights";
import {
  createPlannedCampaign,
  MoldNotFoundError,
  type MoldRef,
  type PlanAnswers,
  type PublishResult,
} from "@/lib/meta-business/marketing/ai-creation";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

export type CreateAiCampaignRequest = {
  mold: MoldRef;
  answers: PlanAnswers;
};

export type CreateAiCampaignResponse = { success: true } & PublishResult;

export type CreateAiCampaignErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/create?userId=
 *
 * Publishes ACTIVE from the approved mold + answers. No change note required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<CreateAiCampaignResponse | CreateAiCampaignErrorResponse>
> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(
      request,
      accountIdParam,
      "create",
    );
    if (!auth.ok) {
      return auth.response as NextResponse<
        CreateAiCampaignResponse | CreateAiCampaignErrorResponse
      >;
    }

    const body = (await request.json()) as Partial<CreateAiCampaignRequest>;
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

    const result = await createPlannedCampaign(
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

    return NextResponse.json({ success: true, ...result });
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

    console.error("[ai/create] failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: "Create failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível criar a campanha.",
        solution: "Tente novamente em alguns instantes.",
      },
      { status: 500 },
    );
  }
}
