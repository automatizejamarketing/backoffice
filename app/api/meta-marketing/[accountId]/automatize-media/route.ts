import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getAllUserGeneratedImages } from "@/lib/db/admin-queries";

export type AutomatizeMediaItem = {
  id: string;
  imageUrl: string;
  prompt: string | null;
  aspectRatio: string | null;
  createdAt: string;
};

export type GetAutomatizeMediaResponse = {
  media: AutomatizeMediaItem[];
  total: number;
  page: number;
  limit: number;
};

export type AutomatizeMediaErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

/**
 * Lists the SELECTED user's completed AI-generated images ("Automatize
 * media") for use as an ad creative. DB-only — no Meta token needed.
 * `accountId` is unused (kept for the [accountId]/ RBAC route convention,
 * same as instagram/user-media).
 */
export async function GET(
  request: NextRequest,
  _ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetAutomatizeMediaResponse | AutomatizeMediaErrorResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's media to list",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:read",
    );
    if (!authz.ok) return authz.response;

    const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "24", 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit =
      Number.isNaN(limitParam) || limitParam < 1
        ? 24
        : Math.min(limitParam, 60);

    const result = await getAllUserGeneratedImages({
      userId,
      status: "completed",
      page,
      limit,
    });

    const media: AutomatizeMediaItem[] = result.posts
      .filter((p): p is typeof p & { imageUrl: string } =>
        Boolean(p.imageUrl),
      )
      .map((p) => ({
        id: p.id,
        imageUrl: p.imageUrl,
        prompt: p.prompt ?? null,
        aspectRatio: p.aspectRatio ?? null,
        createdAt:
          p.createdAt instanceof Date
            ? p.createdAt.toISOString()
            : String(p.createdAt),
      }));

    return NextResponse.json(
      { media, total: result.total, page: result.page, limit: result.limit },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error listing automatize media:", error);
    return NextResponse.json(
      {
        error: "Erro interno",
        message: "Não foi possível carregar as mídias do Automatize.",
        solution: "Tente novamente em alguns instantes.",
      },
      { status: 500 },
    );
  }
}
