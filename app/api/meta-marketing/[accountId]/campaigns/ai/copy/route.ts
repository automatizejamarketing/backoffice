import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { AI_MODELS } from "@/lib/config/models";
import { trackAiUsage } from "@/lib/ai/usage-tracker";
import { getPrimaryCompanyForUser } from "@/lib/db/admin-queries";
import {
  buildCopyPrompt,
  generatedCopySchema,
  sanitizeOffer,
  type GeneratedCopy,
} from "@/lib/meta-business/marketing/ai-creation/generate-copy";
import { authorizeAiCampaignWrite } from "@/lib/meta-business/ai-campaign-auth";

export type GenerateCopyRequest = {
  offer: string;
  objective: "sales" | "leads";
};

export type GenerateCopyResponse = { success: true } & GeneratedCopy;

export type GenerateCopyErrorResponse = {
  success: false;
  error: string;
  message: string;
};

function cityFromAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const city = (raw as { city?: unknown }).city;
  return typeof city === "string" && city.trim() ? city.trim() : null;
}

/**
 * POST /api/meta-marketing/[accountId]/campaigns/ai/copy?userId=
 *
 * Writes headline + caption from the offer. Company context comes from the
 * customer userId, never from the browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GenerateCopyResponse | GenerateCopyErrorResponse>> {
  try {
    const { accountId: accountIdParam } = await params;
    const auth = await authorizeAiCampaignWrite(
      request,
      accountIdParam,
      "copy",
      { requireAccountAccess: false },
    );
    if (!auth.ok) {
      return auth.response as NextResponse<
        GenerateCopyResponse | GenerateCopyErrorResponse
      >;
    }

    const body = (await request.json()) as Partial<GenerateCopyRequest>;
    const offer = sanitizeOffer(body.offer ?? "");
    const objective = body.objective === "leads" ? "leads" : "sales";

    if (!offer) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing offer",
          message: "Descreva a oferta para a IA escrever o anúncio.",
        },
        { status: 400 },
      );
    }

    const company = await getPrimaryCompanyForUser(auth.userId);
    const city = cityFromAddress(company?.businessAddress);

    const prompt = buildCopyPrompt({
      offer,
      objective,
      business: {
        niche: company?.niche ?? null,
        companyName: company?.name ?? null,
        city,
      },
    });

    const result = await generateObject({
      model: gateway.languageModel(AI_MODELS.TEXT_GENERATION),
      schema: generatedCopySchema,
      prompt,
    });

    await trackAiUsage({
      userId: auth.userId,
      modelId: AI_MODELS.TEXT_GENERATION,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
    });

    return NextResponse.json({
      success: true,
      headline: result.object.headline.trim(),
      message: result.object.message.trim(),
    });
  } catch (error) {
    console.error("[ai/copy] failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Copy generation failed",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível escrever o anúncio.",
      },
      { status: 500 },
    );
  }
}
