import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadAiCampaignDuration } from "@/lib/meta-business/marketing/ai-creation/duration-loader";
import type { AiCampaignDurationPolicy } from "@/lib/meta-business/ai-campaign-duration";
import { fetchAccountContext } from "@/lib/meta-business/insights";
import { callMeta, minorToMajor } from "@/lib/meta-business/insights";
import {
  scanAccountForMold,
  listProvenAdsInCampaign,
  SALES_CAMPAIGN_OBJECTIVES,
  type MoldRef,
  type ProvenAdRef,
} from "@/lib/meta-business/marketing/ai-creation";
import { cachedMetaRead, tokenCacheId } from "@/lib/meta-business/read-cache";
import {
  authorizeAiCampaignWrite,
  isTokenInvalidError,
  tokenInvalidJson,
} from "@/lib/meta-business/ai-campaign-auth";

export const maxDuration = 60;

const SCAN_CACHE_TTL_MS = 10 * 60 * 1000;

export type ScanForMoldRequest = {
  objective?: "sales" | "whatsapp" | "followers" | "leads";
};

export type ScanForMoldResponse = {
  success: true;
  mold: MoldRef | null;
  provenAds?: ProvenAdRef[];
  truncated: boolean;
  currency: string;
  durationPolicy: AiCampaignDurationPolicy;
};

export type ScanForMoldErrorResponse = {
  success: false;
  error: string;
  message: string;
  solution?: string;
  needsReconnect?: boolean;
};

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/scan?userId=
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<ScanForMoldResponse | ScanForMoldErrorResponse>> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(request, accountIdParam, "scan");
    if (!auth.ok) {
      return auth.response as NextResponse<
        ScanForMoldResponse | ScanForMoldErrorResponse
      >;
    }

    const body = (await request.json().catch(() => ({}))) as Partial<ScanForMoldRequest>;
    const durationPolicy = await loadAiCampaignDuration(auth.userId, db, { bypassStripe: process.env.BYPASS_STRIPE === "true" });
    const account = await fetchAccountContext({
      adAccountId: auth.accountId,
      accessToken: auth.accessToken,
    });

    if (body.objective && body.objective !== "sales") {
      return NextResponse.json({
        success: true,
        mold: null,
        truncated: false,
        currency: account.currency,
        durationPolicy,
      });
    }

    const payload = await cachedMetaRead({
      key: `aiscan:${tokenCacheId(auth.accessToken)}:${auth.accountId}`,
      ttlMs: SCAN_CACHE_TTL_MS,
      fetcher: async () => {
        const result = await scanAccountForMold(
          {
            adAccountId: auth.accountId,
            accessToken: auth.accessToken,
            currency: account.currency,
            timezoneName: account.timezoneName,
          },
          { objectives: SALES_CAMPAIGN_OBJECTIVES },
        );

        let provenAds: ProvenAdRef[] | undefined;
        if (result.mold) {
          const campaign = await callMeta<{ daily_budget?: string }>({
            domain: "FACEBOOK",
            method: "GET",
            path: result.mold.campaignId,
            params: "fields=daily_budget",
            accessToken: auth.accessToken,
          });
          provenAds = await listProvenAdsInCampaign(
            {
              adAccountId: auth.accountId,
              accessToken: auth.accessToken,
              currency: account.currency,
              timezoneName: account.timezoneName,
            },
            result.mold,
            minorToMajor(campaign?.daily_budget) ?? null,
          );
        }

        return { ...result, provenAds };
      },
    });

    return NextResponse.json({ success: true, ...payload, durationPolicy });
  } catch (error) {
    if (isTokenInvalidError(error)) return tokenInvalidJson();

    console.error("[ai/scan] failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: "Scan failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível analisar a conta de anúncio.",
        solution: "Tente novamente em alguns instantes.",
      },
      { status: 500 },
    );
  }
}
