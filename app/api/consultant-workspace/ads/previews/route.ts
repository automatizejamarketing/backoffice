import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getAdPreviews, PreviewError } from "@/lib/consultant-workspace/creative-previews";

export const dynamic = "force-dynamic";

/** GET ?userId=…&ids=1,2,3 → prévias ao vivo (miniatura, texto) dos anúncios do dossiê. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  try {
    const previews = await getAdPreviews(userId!, ids);
    return NextResponse.json({ previews }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof PreviewError) return NextResponse.json({ previews: {}, error: error.message });
    console.error("[consultant-workspace previews]", error);
    return NextResponse.json({ previews: {}, error: "Não consegui ler as prévias na Meta" }, { status: 502 });
  }
}
