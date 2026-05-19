import { type NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getAdVideoStatus } from "@/lib/meta-business/marketing/upload-ad-video";

export type AdVideoProcessingStatus = {
  videoId: string;
  state: "ready" | "processing" | "error";
  progress?: number;
  errorMessage?: string;
};

export type AdVideoStatusResponse = {
  success: true;
  data: {
    statuses: Record<string, AdVideoProcessingStatus>;
    allReady: boolean;
    hasError: boolean;
  };
};

export type AdVideoStatusErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
};

/**
 * Polls Meta video processing status for a backoffice-driven ad creative.
 * Response shape mirrors the automatize-frontend draft video-status route so
 * the ported polling hook works unchanged.
 */
export async function GET(
  request: NextRequest,
  _ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<AdVideoStatusResponse | AdVideoStatusErrorResponse>> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

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

  const authz = await requireMarketingUserAccessResponse(
    userId,
    "marketing:read",
  );
  if (!authz.ok) {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden",
        message: "Você não tem acesso ao marketing deste usuário.",
      },
      { status: 403 },
    );
  }

  const videoIds = searchParams
    .get("videoIds")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!videoIds || videoIds.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Erro de validação",
        message: "Informe ao menos um videoId para consultar o processamento.",
      },
      { status: 400 },
    );
  }

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

  const { accessToken } = tokenResult;
  const statuses: Record<string, AdVideoProcessingStatus> = {};

  for (const videoId of videoIds) {
    try {
      const status = await getAdVideoStatus(videoId, accessToken);
      statuses[videoId] = {
        videoId,
        state: status.status.video_status,
        progress: status.status.processing_phase?.progress,
        errorMessage: status.status.error?.message,
      };
    } catch (error) {
      statuses[videoId] = {
        videoId,
        state: "error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o vídeo.",
      };
    }
  }

  const values = Object.values(statuses);

  return NextResponse.json({
    success: true,
    data: {
      statuses,
      allReady: values.every((s) => s.state === "ready"),
      hasError: values.some((s) => s.state === "error"),
    },
  });
}
