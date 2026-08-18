import { NextRequest, NextResponse } from "next/server";
import { uploadVideoToMeta } from "@/lib/meta-business/marketing/upload-video-to-meta";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

export type UploadAiVideoRequest = {
  videoUrl: string;
};

export type UploadAiVideoResponse = {
  success: true;
  videoId: string;
  thumbnailUrl?: string;
};

export type UploadAiVideoErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};

const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

function isOwnBlobUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    if (url.hostname.endsWith(BLOB_HOST_SUFFIX)) return true;
    // Mídia migrada para o R2: URLs servidas pelo custom domain próprio
    const mediaBase = process.env.MEDIA_PUBLIC_BASE_URL;
    if (!mediaBase) return false;
    try {
      return url.hostname === new URL(mediaBase).hostname;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/video?userId=
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<UploadAiVideoResponse | UploadAiVideoErrorResponse>> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(
      request,
      accountIdParam,
      "video",
    );
    if (!auth.ok) {
      return auth.response as NextResponse<
        UploadAiVideoResponse | UploadAiVideoErrorResponse
      >;
    }

    const body = (await request.json()) as Partial<UploadAiVideoRequest>;
    const videoUrl = body.videoUrl?.trim() ?? "";

    if (!videoUrl) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid request",
          message: "Informe o vídeo a enviar.",
        },
        { status: 400 },
      );
    }

    if (!isOwnBlobUrl(videoUrl)) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid video URL",
          message: "Este vídeo não veio de um upload deste aplicativo.",
          solution: "Envie o vídeo pelo seletor de mídias.",
        },
        { status: 400 },
      );
    }

    // new URL().toString() percent-encoda espaços/acentos — URLs antigas gravadas
    // cruas no banco viram URLs válidas para o fetcher da Meta (erro 389)
    const normalizedVideoUrl = new URL(videoUrl).toString();

    const { id, thumbnailUrl } = await uploadVideoToMeta({
      adAccountId: `act_${auth.accountId}`,
      accessToken: auth.accessToken,
      videoUrl: normalizedVideoUrl,
    });

    const realThumbnail =
      thumbnailUrl && thumbnailUrl !== videoUrl ? thumbnailUrl : undefined;

    return NextResponse.json({
      success: true,
      videoId: id,
      ...(realThumbnail ? { thumbnailUrl: realThumbnail } : {}),
    });
  } catch (error) {
    if (isTokenInvalidError(error)) return tokenInvalidJson();

    console.error("[ai/video] upload failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: "Upload failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o vídeo para a Meta.",
        solution: "Tente novamente ou escolha outra mídia.",
      },
      { status: 500 },
    );
  }
}
