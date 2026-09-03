import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  getPageWhatsappNumber,
  pageWhatsappAddUrl,
  pageWhatsappEditUrl,
  pageWhatsappSettingsUrl,
  type PageWhatsappNumber,
} from "@/lib/meta-business/marketing/page-whatsapp-number";

export type PageWhatsappNumberResponse = {
  success: true;
  pageId: string;
  settingsUrl: string;
  addUrl: string;
  editUrl: string;
} & PageWhatsappNumber;

export type PageWhatsappNumberErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
};

/**
 * GET /api/meta-marketing/[accountId]/pages/[pageId]/whatsapp-number?userId=
 *
 * Which WhatsApp number a click-to-WhatsApp campaign on this Page would send
 * people to. `unknown` means we could not look — it must not block publish.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; pageId: string }> },
): Promise<
  NextResponse<PageWhatsappNumberResponse | PageWhatsappNumberErrorResponse>
> {
  try {
    const { accountId, pageId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing userId",
          message: "userId query parameter is required",
        },
        { status: 400 },
      );
    }

    if (!pageId) {
      return NextResponse.json(
        {
          success: false,
          error: "missing_page",
          message: "Informe a página.",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response as NextResponse<PageWhatsappNumberErrorResponse>;

    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }

    const result = await getPageWhatsappNumber(
      tokenResult.accessToken,
      pageId,
      {
        adAccountId: accountId,
        businessId: tokenResult.connection.clientBusinessId,
      },
    );

    return NextResponse.json({
      success: true,
      pageId,
      settingsUrl: pageWhatsappSettingsUrl(pageId),
      addUrl: pageWhatsappAddUrl(pageId),
      editUrl: pageWhatsappEditUrl(pageId),
      ...result,
    });
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    return NextResponse.json(
      {
        success: false,
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}
