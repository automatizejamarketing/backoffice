import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { OfferSuggestionError, suggestOffers } from "@/lib/consultant-workspace/offer-suggestion-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { userId, adIds?, days? } → 3 ofertas/combos sugeridas pela IA para o criativo ruim. Nada é salvo. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: string; adIds?: unknown; days?: unknown };
  const authz = await requireMarketingUserAccessResponse(body.userId, "marketing:write");
  if (!authz.ok) return authz.response;
  const adIds = Array.isArray(body.adIds)
    ? body.adIds.filter((id): id is string => typeof id === "string" && /^\d{3,30}$/.test(id)).slice(0, 3)
    : undefined;
  const days = Number(body.days) || 7;
  try {
    return NextResponse.json(await suggestOffers(authz.actor, { userId: body.userId!, adIds, days }));
  } catch (error) {
    if (error instanceof OfferSuggestionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[consultant-workspace offer-suggestion]", error);
    return NextResponse.json({ error: "Falha ao sugerir ofertas" }, { status: 500 });
  }
}
