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
  GraphApiError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { duplicateAd } from "@/lib/meta-business/duplicate";
import {
  buildCreativeFromMedia,
  resolvePageAndIg,
  type AdMediaInput,
} from "@/lib/meta-business/marketing/build-ad-from-media";
import { cleanupBlobAfterMetaIngestion } from "@/lib/meta-business/marketing/cleanup-blob-after-meta";
import { getAdVideoStatus } from "@/lib/meta-business/marketing/upload-ad-video";

type EditMediaInput =
  | { source: "instagram"; instagramMediaId: string }
  | { source: "automatize_media"; generatedImageId: string }
  | { source: "device"; blobUrl: string; mediaType: "image" | "video" };

type EditCreativeRequestBody = {
  media: EditMediaInput;
  text: {
    titles?: string[];
    texts?: string[];
    ctaType?: string;
    linkUrl?: string;
  };
  confirmVideoId?: string;
  /** Facebook Page chosen as the ad identity (page-first selection). */
  pageId?: string;
};

type EditCreativeSuccess =
  | {
      success: true;
      phase: "processing";
      videoId: string;
      thumbnailUrl: string;
    }
  | {
      success: true;
      strategy: "repoint";
      adId: string;
      creativeId: string;
      auditLogFailed?: boolean;
    }
  | {
      success: true;
      strategy: "duplicate_paused";
      newAdId: string;
      pausedAdId: string;
      creativeId: string;
      message: string;
      auditLogFailed?: boolean;
    };

type EditCreativeError = {
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

async function repointAd(
  adId: string,
  creativeId: string,
  accessToken: string,
): Promise<void> {
  await metaApiCall<{ success?: boolean; id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: adId,
    params: "",
    body: new URLSearchParams({
      creative: JSON.stringify({ creative_id: creativeId }),
    }),
    accessToken,
  });
}

/**
 * Meta locks a creative once the ad has delivered/engaged: a non-transient
 * 4xx on the repoint POST is the signal to fall back to duplicate+pause.
 * Transient or 5xx errors are real failures and must surface as retryable.
 */
function isRepointRejected(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  const { statusCode, reason } = error.errorReturn;
  return statusCode >= 400 && statusCode < 500 && !reason.isTransient;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<NextResponse<EditCreativeSuccess | EditCreativeError>> {
  try {
    const { accountId, adId } = await params;
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

    const body = (await request.json()) as EditCreativeRequestBody;
    const linkUrl = body.text?.linkUrl?.trim();

    if (!body.media || !linkUrl) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "media e text.linkUrl são obrigatórios.",
          solution:
            "Selecione uma mídia e informe a URL de destino (https://).",
        },
        { status: 400 },
      );
    }

    const ad = await metaApiCall<{
      id: string;
      name?: string;
      adset_id?: string;
      campaign_id?: string;
      effective_status?: string;
      adset?: {
        id?: string;
        is_dynamic_creative?: boolean;
        destination_type?: string;
        optimization_goal?: string;
        promoted_object?: { page_id?: string };
      };
    }>({
      domain: "FACEBOOK",
      method: "GET",
      path: adId,
      params:
        "fields=id,name,adset_id,campaign_id,effective_status,adset{id,is_dynamic_creative,destination_type,optimization_goal,promoted_object}",
      accessToken,
    });

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
            solution:
              "Escolha outra publicação elegível para impulsionamento.",
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

    // Page-first identity: the admin may change the Facebook Page of the ad.
    // For objectives that promote the page (traffic/leads/engagement/awareness),
    // the parent ad set locks the page via promoted_object.page_id, so the
    // creative page MUST match it — reject a divergent choice with a clear
    // message. Sales ad sets promote a pixel (no page), so any page is allowed.
    const requestedPageId = body.pageId?.trim();
    const adsetPageId = ad.adset?.promoted_object?.page_id;
    if (requestedPageId && adsetPageId && requestedPageId !== adsetPageId) {
      return NextResponse.json(
        {
          error: "Página fixada pelo conjunto",
          message:
            "Para este objetivo, a Página do anúncio é definida pelo conjunto de anúncios e não pode ser alterada por anúncio.",
          solution:
            "Crie um novo conjunto de anúncios com a Página desejada para veicular sob outra identidade.",
        },
        { status: 400 },
      );
    }
    const page = await resolvePageAndIg(
      accessToken,
      requestedPageId ?? adsetPageId,
    );
    const text = {
      titles: body.text.titles ?? [],
      texts: body.text.texts ?? [],
      ctaType: body.text.ctaType,
      linkUrl,
    };

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
              status.status.video_status === "error"
                ? "error"
                : "processing",
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
      name: `${ad.name ?? "Anúncio"} - creative`,
      media,
      text,
      page,
      adSetIsDynamic: ad.adset?.is_dynamic_creative === true,
      adSetDestinationType: ad.adset?.destination_type,
      adSetOptimizationGoal: ad.adset?.optimization_goal,
      confirmedVideo,
    });

    if (outcome.phase === "video_processing") {
      try {
        await createAdCreativeEditLog({
          backofficeUserEmail: authz.actor.email,
          targetUserId: userId,
          accountId,
          campaignId: ad.campaign_id ?? null,
          adsetId: ad.adset_id ?? "",
          operation: "edit",
          sourceAdId: adId,
          mediaSource,
          mediaKind: "video",
          videoId: outcome.videoId,
          videoStatus: "processing",
          appliedToMeta: false,
          message:
            "Upload de vídeo iniciado; aguardando processamento da Meta.",
        });
      } catch (dbErr) {
        console.error("[POST edit creative] processing audit failed:", dbErr);
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

    const creativeId = outcome.creativeId;

    // Try to repoint the existing ad; on a non-transient 4xx (locked/engaged
    // creative) fall back to duplicate-with-new-creative + pause original.
    let strategy: "repoint" | "duplicate_paused";
    let resultAdId: string;
    let pausedAdId: string | undefined;
    let editMessage: string | undefined;

    try {
      await repointAd(adId, creativeId, accessToken);
      strategy = "repoint";
      resultAdId = adId;
    } catch (repointError) {
      if (!isRepointRejected(repointError)) {
        throw repointError;
      }
      const copy = await duplicateAd({ accountId, adId, accessToken });
      await repointAd(copy.id, creativeId, accessToken);
      await metaApiCall<{ success?: boolean }>({
        domain: "FACEBOOK",
        method: "POST",
        path: adId,
        params: "",
        body: new URLSearchParams({ status: "PAUSED" }),
        accessToken,
      });
      strategy = "duplicate_paused";
      resultAdId = copy.id;
      pausedAdId = adId;
      editMessage =
        "O anúncio original estava ativo/com engajamento, então um novo anúncio foi criado no mesmo conjunto com o novo criativo e o original foi pausado.";
    }

    if (blobUrlForCleanup) {
      void cleanupBlobAfterMetaIngestion({
        blobUrls: [blobUrlForCleanup],
        adCreativeIds: [creativeId],
        accessToken,
      }).catch(() => {});
    }

    let auditLogFailed = false;
    try {
      await createAdCreativeEditLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        accountId,
        campaignId: ad.campaign_id ?? null,
        adsetId: ad.adset_id ?? "",
        operation: "edit",
        editStrategy: strategy,
        sourceAdId: adId,
        resultAdId,
        pausedAdId,
        creativeId,
        mediaSource,
        mediaKind: outcome.mediaKind,
        videoId: outcome.videoId,
        videoStatus: outcome.videoId ? "ready" : undefined,
        appliedToMeta: true,
        message: editMessage,
      });
    } catch (dbErr) {
      console.error("[POST edit creative] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    if (strategy === "repoint") {
      return NextResponse.json(
        {
          success: true,
          strategy: "repoint",
          adId: resultAdId,
          creativeId,
          auditLogFailed,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        strategy: "duplicate_paused",
        newAdId: resultAdId,
        pausedAdId: pausedAdId as string,
        creativeId,
        message: editMessage as string,
        auditLogFailed,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST edit creative] Error:", errorReturn);
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
