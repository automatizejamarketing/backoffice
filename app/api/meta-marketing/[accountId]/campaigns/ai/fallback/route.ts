import { NextRequest, NextResponse } from "next/server";
import type { SelectedGeoLocation } from "@/lib/meta-business/geo-targeting-types";
import type {
  CampaignDeliveryMode,
  CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import type { PlanMedia, PlanTexts } from "@/lib/meta-business/marketing/ai-creation";
import type { PlacementKey } from "@/lib/meta-business/placements";
import type { PublishResult } from "@/lib/meta-business/marketing/ai-creation";
import {
  publishFallbackCampaign,
  type FallbackNiche,
  type FallbackObjective,
  type FallbackPeriod,
} from "@/lib/meta-business/marketing/ai-creation/fallback-publish";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

export type FallbackAiCampaignRequest = {
  niche: FallbackNiche;
  objective: FallbackObjective;
  dailyBudget: number;
  media?: PlanMedia[];
  medias?: PlanMedia[];
  texts?: PlanTexts;
  promotionUrl?: string;
  locations: SelectedGeoLocation[];
  pageId: string;
  instagramUserId?: string | null;
  instagramBusinessAccountId?: string | null;
  pixelId?: string | null;
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
  period?: FallbackPeriod;
  placementsMode?: "automatic" | "manual";
  selectedPlacements?: PlacementKey[];
};

export type FallbackAiCampaignResponse = { success: true } & PublishResult;

export type FallbackAiCampaignErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};

const NICHES = new Set<FallbackNiche>([
  "food_service",
  "retail",
  "real_estate_broker",
  "service",
  "insurance_broker",
  "outros",
]);

const OBJECTIVES = new Set<FallbackObjective>([
  "sales",
  "whatsapp",
  "followers",
  "leads",
]);

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/fallback?userId=
 *
 * No-mold path: publishes ACTIVE via createCampaignTree using the same Meta
 * fields as the frontend niche creators. No change note required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<FallbackAiCampaignResponse | FallbackAiCampaignErrorResponse>
> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(
      request,
      accountIdParam,
      "fallback",
    );
    if (!auth.ok) {
      return auth.response as NextResponse<
        FallbackAiCampaignResponse | FallbackAiCampaignErrorResponse
      >;
    }

    const body = (await request.json()) as Partial<FallbackAiCampaignRequest>;
    const niche = body.niche;
    const objective = body.objective;
    const media = body.media ?? body.medias ?? [];

    if (!niche || !NICHES.has(niche) || !objective || !OBJECTIVES.has(objective)) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid request",
          message:
            "Informe um nicho (food_service, retail, real_estate_broker, service, outros) e um objetivo (sales, followers, leads).",
        },
        { status: 400 },
      );
    }

    if (typeof body.dailyBudget !== "number" || !body.pageId) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid request",
          message: "Informe dailyBudget e pageId.",
        },
        { status: 400 },
      );
    }

    const result = await publishFallbackCampaign({
      adAccountId: auth.accountId,
      accessToken: auth.accessToken,
      input: {
        niche,
        objective,
        dailyBudget: body.dailyBudget,
        media,
        texts: body.texts,
        promotionUrl: body.promotionUrl,
        locations: body.locations ?? [],
        pageId: body.pageId,
        instagramUserId:
          body.instagramUserId ?? body.instagramBusinessAccountId ?? null,
        pixelId: body.pixelId ?? null,
        deliveryMode: body.deliveryMode,
        scheduleBlocks: body.scheduleBlocks,
        period: body.period,
        placementsMode: body.placementsMode,
        selectedPlacements: body.selectedPlacements,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isTokenInvalidError(error)) return tokenInvalidJson();

    console.error("[ai/fallback] failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: "Fallback create failed",
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
