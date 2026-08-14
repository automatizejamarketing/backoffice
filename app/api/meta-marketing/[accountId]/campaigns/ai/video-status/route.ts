import { NextRequest, NextResponse } from "next/server";
import { getAdVideoStatus } from "@/lib/meta-business/marketing/upload-ad-video";
import { authorizeAiCampaignWrite } from "@/lib/meta-business/ai-campaign-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const resolved = await authorizeAiCampaignWrite(
      request,
      accountId,
      "video-status",
    );
    if (!resolved.ok) return resolved.response;

    const videoIds = request.nextUrl.searchParams
      .get("videoIds")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!videoIds?.length) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Informe ao menos um videoId.",
        },
        { status: 400 },
      );
    }

    const statuses: Record<
      string,
      { videoId: string; state: "ready" | "processing" | "error"; errorMessage?: string }
    > = {};

    await Promise.all(
      videoIds.map(async (videoId) => {
        try {
          const status = await getAdVideoStatus(
            videoId,
            resolved.accessToken,
          );
          const raw = String(status.status?.video_status ?? "").toLowerCase();
          statuses[videoId] = {
            videoId,
            state:
              raw === "ready"
                ? "ready"
                : raw === "error"
                  ? "error"
                  : "processing",
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
      }),
    );

    const values = Object.values(statuses);
    return NextResponse.json({
      success: true,
      data: {
        statuses,
        allReady: values.every((item) => item.state === "ready"),
        hasError: values.some((item) => item.state === "error"),
      },
    });
  } catch (error) {
    console.error("[backoffice ai/video-status] failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Status failed",
        message: "Não foi possível consultar o processamento do vídeo.",
      },
      { status: 500 },
    );
  }
}
