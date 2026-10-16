import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  AD_PREVIEW_FORMATS,
  getAdPreviewFrame,
  PreviewError,
  type AdPreviewFormat,
} from "@/lib/consultant-workspace/creative-previews";

export const dynamic = "force-dynamic";

/** GET ?userId=…&adId=…&format=MOBILE_FEED_STANDARD → URL do iframe de prévia da Meta. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;
  const adId = url.searchParams.get("adId") ?? "";
  const requested = url.searchParams.get("format") as AdPreviewFormat | null;
  const format = requested && AD_PREVIEW_FORMATS.includes(requested) ? requested : "MOBILE_FEED_STANDARD";
  try {
    return NextResponse.json({ src: await getAdPreviewFrame(userId!, adId, format) });
  } catch (error) {
    if (error instanceof PreviewError) return NextResponse.json({ src: null, error: error.message });
    console.warn("[consultant-workspace preview-frame]", adId, format, error instanceof Error ? error.message : error);
    return NextResponse.json({ src: null, error: "A Meta não gerou a prévia neste formato" });
  }
}
