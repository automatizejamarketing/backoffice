import { NextRequest, NextResponse } from "next/server";
import { buildDegreesOfFreedomSpec } from "@/lib/meta-business/creative-features";
import {
  generatePlacementPreviews,
  type PlacementPreview,
  usableLink,
} from "@/lib/meta-business/marketing/placement-previews";
import { ALL_PLACEMENTS, type PlacementKey } from "@/lib/meta-business/placements";
import { uploadImageToAdAccount } from "@/lib/meta-business/marketing/upload-ad-image";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

export type PlacementPreviewsRequest = {
  pageId: string;
  instagramUserId?: string;
  imageHash?: string;
  /** URL da imagem quando o hash ainda não existe — resolvido no servidor. */
  imageUrl?: string;
  videoId?: string;
  thumbnailUrl?: string;
  instagramMediaId?: string;
  headline?: string;
  message?: string;
  link?: string;
  ctaType?: string;
  placements?: PlacementKey[];
  generativeExpansion?: boolean;
};

export type PlacementPreviewsResponse = {
  success: true;
  previews: PlacementPreview[];
};

export type PlacementPreviewsErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};


/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/previews?userId=
 *
 * Espelha a rota do app do cliente: renderiza o criativo em cada posicionamento
 * antes de publicar. Aqui o admin opera EM NOME de um cliente, então o token vem
 * de `authorizeAiCampaignWrite` (que já resolve o userId e checa o acesso do
 * operador à conta).
 *
 * Não cria criativo nem anúncio. A única escrita possível é o upload da imagem
 * para a biblioteca da conta quando o cliente manda `imageUrl` — a mesma chamada
 * que a publicação faria, deduplicada por hash pelo Meta.
 *
 * O preview NÃO reflete `adapt_to_placement` (comprovado em anúncio real); ele
 * mostra o criativo dentro do frame de cada posicionamento. Ver
 * `lib/meta-business/marketing/placement-previews.ts`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<PlacementPreviewsResponse | PlacementPreviewsErrorResponse>> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(request, accountIdParam, "previews");
    if (!auth.ok) {
      return auth.response as NextResponse<PlacementPreviewsErrorResponse>;
    }
    const { accessToken, accountId } = auth;

    const body = (await request.json()) as Partial<PlacementPreviewsRequest>;
    const pageId = body.pageId?.trim();
    if (!pageId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing parameters",
          message: "Informe a página do anúncio.",
        },
        { status: 400 },
      );
    }

    if (!body.imageHash && !body.imageUrl && !body.videoId && !body.instagramMediaId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing media",
          message: "Informe a mídia (imagem, vídeo ou post do Instagram) do anúncio.",
        },
        { status: 400 },
      );
    }

    let imageHash = body.imageHash;
    if (!imageHash && body.imageUrl && !body.videoId && !body.instagramMediaId) {
      const uploaded = await uploadImageToAdAccount({
        adAccountId: accountId,
        accessToken,
        imageUrl: body.imageUrl,
      });
      imageHash = uploaded.hash;
    }

    const link = usableLink(body.link);
    const callToAction = { type: body.ctaType || "LEARN_MORE", value: { link } };

    const creative: Record<string, unknown> = body.instagramMediaId
      ? {
          source_instagram_media_id: body.instagramMediaId,
          object_id: pageId,
          ...(body.instagramUserId ? { instagram_user_id: body.instagramUserId } : {}),
          call_to_action: callToAction,
        }
      : {
          object_story_spec: {
            page_id: pageId,
            ...(body.instagramUserId ? { instagram_user_id: body.instagramUserId } : {}),
            ...(body.videoId
              ? {
                  video_data: {
                    video_id: body.videoId,
                    ...(body.thumbnailUrl ? { image_url: body.thumbnailUrl } : {}),
                    ...(body.message ? { message: body.message } : {}),
                    ...(body.headline ? { title: body.headline } : {}),
                    call_to_action: callToAction,
                  },
                }
              : {
                  link_data: {
                    link,
                    image_hash: imageHash,
                    ...(body.message ? { message: body.message } : {}),
                    ...(body.headline ? { name: body.headline } : {}),
                    call_to_action: callToAction,
                  },
                }),
          },
        };

    const dof = buildDegreesOfFreedomSpec({
      generativeExpansion: body.generativeExpansion ?? false,
    });
    if (dof) creative.degrees_of_freedom_spec = dof;

    const requested = body.placements?.length ? body.placements : ALL_PLACEMENTS;
    const placements = requested.filter((p): p is PlacementKey =>
      (ALL_PLACEMENTS as readonly string[]).includes(p),
    );

    const previews = await generatePlacementPreviews({
      adAccountId: accountId,
      accessToken,
      creative,
      placements,
    });

    return NextResponse.json({ success: true, previews });
  } catch (error) {
    if (isTokenInvalidError(error)) {
      return tokenInvalidJson() as NextResponse<PlacementPreviewsErrorResponse>;
    }
    console.error("[backoffice ai/previews] failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Preview generation failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível gerar os previews.",
      },
      { status: 500 },
    );
  }
}
