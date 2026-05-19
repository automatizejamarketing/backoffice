import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { createAdCreativeEditLog } from "@/lib/db/admin-queries";
import { db } from "@/lib/db/index";
import { blobUpload, generatedImage } from "@/lib/db/schema";
import { metaApiCall } from "@/lib/meta-business/api";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  buildCreativeFromMedia,
  resolvePageAndIg,
  type AdMediaInput,
} from "@/lib/meta-business/marketing/build-ad-from-media";
import { createAd } from "@/lib/meta-business/marketing/creative-builders";
import { cleanupBlobAfterMetaIngestion } from "@/lib/meta-business/marketing/cleanup-blob-after-meta";
import { getAdVideoStatus } from "@/lib/meta-business/marketing/upload-ad-video";

type CreateAdMediaInput =
  | { source: "instagram"; instagramMediaId: string }
  | { source: "automatize_media"; generatedImageId: string }
  | { source: "device"; blobUrl: string; mediaType: "image" | "video" };

type CreateAdRequestBody = {
  media: CreateAdMediaInput;
  text: {
    titles?: string[];
    texts?: string[];
    ctaType?: string;
    linkUrl?: string;
  };
  adName?: string;
  status?: "ACTIVE" | "PAUSED";
  confirmVideoId?: string;
};

type CreateAdSuccess =
  | {
      success: true;
      phase: "created";
      adId: string;
      creativeId: string;
      mediaKind: "image" | "video" | "instagram_post";
      auditLogFailed?: boolean;
    }
  | {
      success: true;
      phase: "processing";
      videoId: string;
      thumbnailUrl: string;
    };

type CreateAdError = {
  success?: false;
  error: string;
  message: string;
  solution?: string;
  phase?: "processing" | "error";
};

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

async function fetchVideoPicture(
  videoId: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const res = await metaApiCall<{ picture?: string }>({
      domain: "FACEBOOK",
      method: "GET",
      path: videoId,
      params: "fields=picture",
      accessToken,
    });
    return res.picture;
  } catch {
    return undefined;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<CreateAdSuccess | CreateAdError>> {
  try {
    const { accountId, adsetId } = await params;
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

    const body = (await request.json()) as CreateAdRequestBody;
    const linkUrl = body.text?.linkUrl?.trim();

    if (!body.media || !linkUrl) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "media e text.linkUrl são obrigatórios.",
          solution: "Selecione uma mídia e informe a URL de destino (https://).",
        },
        { status: 400 },
      );
    }


    // Validate the ad set and derive name + campaign.
    const adset = await metaApiCall<{
      id: string;
      name?: string;
      campaign_id?: string;
      is_dynamic_creative?: boolean;
      optimization_goal?: string;
      billing_event?: string;
      status?: string;
      destination_type?: string;
      promoted_object?: { page_id?: string };
    }>({
      domain: "FACEBOOK",
      method: "GET",
      path: adsetId,
      params:
        "fields=id,name,campaign_id,is_dynamic_creative,optimization_goal,billing_event,status,destination_type,promoted_object",
      accessToken,
    });


    // Resolve & validate the media into the orchestrator input.
    let media: AdMediaInput;
    let mediaSource:
      | "instagram"
      | "automatize_media"
      | "device_image"
      | "device_video";
    let blobUrlForCleanup: string | undefined;

    if (body.media.source === "instagram") {
      const eligibility = await metaApiCall<{
        boost_eligibility_info?: {
          eligible_to_boost?: boolean;
          ineligible_reason?: string;
        };
      }>({
        domain: "FACEBOOK",
        method: "GET",
        path: body.media.instagramMediaId,
        params: "fields=id,boost_eligibility_info",
        accessToken,
      });
      if (eligibility.boost_eligibility_info?.eligible_to_boost !== true) {
        return NextResponse.json(
          {
            error: "Mídia do Instagram não elegível",
            message:
              eligibility.boost_eligibility_info?.ineligible_reason ??
              "Esta publicação do Instagram não pode ser promovida.",
            solution: "Escolha outra publicação elegível para impulsionamento.",
          },
          { status: 400 },
        );
      }
      media = {
        kind: "instagram",
        instagramMediaId: body.media.instagramMediaId,
      };
      mediaSource = "instagram";
    } else if (body.media.source === "automatize_media") {
      const [row] = await db
        .select({ imageUrl: generatedImage.publicImageUrl })
        .from(generatedImage)
        .where(
          and(
            eq(generatedImage.id, body.media.generatedImageId),
            eq(generatedImage.userId, userId),
            eq(generatedImage.status, "completed"),
            isNull(generatedImage.deletedAt),
          ),
        )
        .limit(1);

      if (!row?.imageUrl) {
        return NextResponse.json(
          {
            error: "Mídia não encontrada",
            message:
              "A mídia do Automatize selecionada não foi encontrada para este usuário.",
            solution: "Atualize a lista e selecione outra mídia.",
          },
          { status: 404 },
        );
      }
      media = { kind: "automatize_image", imageUrl: row.imageUrl };
      mediaSource = "automatize_media";
    } else {
      const blobUrl = body.media.blobUrl;
      const [row] = await db
        .select({ id: blobUpload.id })
        .from(blobUpload)
        .where(
          and(
            eq(blobUpload.blobUrl, blobUrl),
            eq(blobUpload.userId, userId),
            eq(blobUpload.source, "campaign_media"),
            isNull(blobUpload.deletedAt),
          ),
        )
        .limit(1);

      if (!row) {
        return NextResponse.json(
          {
            error: "Upload não encontrado",
            message:
              "O arquivo enviado não foi encontrado. Reenvie a mídia e tente novamente.",
          },
          { status: 404 },
        );
      }
      blobUrlForCleanup = blobUrl;
      if (body.media.mediaType === "video") {
        media = { kind: "device_video", blobUrl };
        mediaSource = "device_video";
      } else {
        media = { kind: "device_image", blobUrl };
        mediaSource = "device_image";
      }
    }


    const page = await resolvePageAndIg(
      accessToken,
      adset.promoted_object?.page_id,
    );
    const name = body.adName?.trim() || `${adset.name ?? "Anúncio"} - Ad`;
    const adStatus = body.status === "ACTIVE" ? "ACTIVE" : "PAUSED";

    const text = {
      titles: body.text.titles ?? [],
      texts: body.text.texts ?? [],
      ctaType: body.text.ctaType,
      linkUrl,
    };


    // Device video, second pass: caller confirms the uploaded video is ready.
    let confirmedVideo: { videoId: string; thumbnailUrl: string } | undefined;
    if (media.kind === "device_video" && body.confirmVideoId) {
      const status = await getAdVideoStatus(body.confirmVideoId, accessToken);
      if (status.status.video_status !== "ready") {
        return NextResponse.json(
          {
            error: "Vídeo ainda processando",
            message:
              status.status.video_status === "error"
                ? (status.status.error?.message ??
                  "Falha ao processar o vídeo na Meta.")
                : "O vídeo ainda está sendo processado pela Meta.",
            phase:
              status.status.video_status === "error" ? "error" : "processing",
          },
          { status: 409 },
        );
      }
      const picture = await fetchVideoPicture(
        body.confirmVideoId,
        accessToken,
      );
      confirmedVideo = {
        videoId: body.confirmVideoId,
        thumbnailUrl: picture ?? (blobUrlForCleanup as string),
      };
    }

    const outcome = await buildCreativeFromMedia({
      adAccountId: formatAccountId(accountId),
      accessToken,
      name,
      media,
      text,
      page,
      adSetIsDynamic: adset.is_dynamic_creative === true,
      adSetDestinationType: adset.destination_type,
      adSetOptimizationGoal: adset.optimization_goal,
      confirmedVideo,
    });


    // First device-video pass: video is processing — client must poll then
    // re-POST with confirmVideoId.
    if (outcome.phase === "video_processing") {
      try {
        await createAdCreativeEditLog({
          backofficeUserEmail: authz.actor.email,
          targetUserId: userId,
          accountId,
          campaignId: adset.campaign_id ?? null,
          adsetId,
          operation: "create",
          editStrategy: "create_only",
          mediaSource,
          mediaKind: "video",
          videoId: outcome.videoId,
          videoStatus: "processing",
          appliedToMeta: false,
          message: "Upload de vídeo iniciado; aguardando processamento da Meta.",
        });
      } catch (dbErr) {
        console.error("[POST create ad] processing audit failed:", dbErr);
      }
      return NextResponse.json(
        {
          success: true,
          phase: "processing",
          videoId: outcome.videoId,
          thumbnailUrl: outcome.thumbnailUrl,
        },
        { status: 202 },
      );
    }


    const ad = await createAd({
      adAccountId: formatAccountId(accountId),
      accessToken,
      adSetId: adsetId,
      creativeId: outcome.creativeId,
      name,
      status: adStatus,
    });


    if (blobUrlForCleanup) {
      void cleanupBlobAfterMetaIngestion({
        blobUrls: [blobUrlForCleanup],
        adCreativeIds: [outcome.creativeId],
        accessToken,
      }).catch(() => {});
    }

    let auditLogFailed = false;
    try {
      await createAdCreativeEditLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        accountId,
        campaignId: adset.campaign_id ?? null,
        adsetId,
        operation: "create",
        editStrategy: "create_only",
        resultAdId: ad.id,
        creativeId: outcome.creativeId,
        mediaSource,
        mediaKind: outcome.mediaKind,
        videoId: outcome.videoId,
        videoStatus: outcome.videoId ? "ready" : undefined,
        appliedToMeta: true,
      });
    } catch (dbErr) {
      console.error("[POST create ad] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      {
        success: true,
        phase: "created",
        adId: ad.id,
        creativeId: outcome.creativeId,
        mediaKind: outcome.mediaKind,
        auditLogFailed,
      },
      { status: 201 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST create ad] Error:", errorReturn);
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
