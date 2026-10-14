import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  loadSuggestedActions,
  runLiveChecks,
  SuggestedActionsError,
} from "@/lib/consultant-workspace/playbook-actions-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Checar agora" fura o cache de 5 min; o teto evita martelar a Meta com o token do cliente. */
const FRESH_LIVE_LIMIT = { limit: 60, windowSeconds: 3600 };

/**
 * GET ?userId=…&days=7 → ações sugeridas do banco (escalar, criativo ruim).
 * GET ?userId=…&live=1[&fresh=1] → checagens ao vivo de UM cliente (pixel, saldo).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 7) || 7, 1), 90);
  try {
    if (url.searchParams.get("live") === "1") {
      let fresh = url.searchParams.get("fresh") === "1";
      if (fresh && !checkRateLimit(`consultant-live-check:${authz.actor.email}`, FRESH_LIVE_LIMIT).success) fresh = false;
      return NextResponse.json(await runLiveChecks(authz.actor, userId!, { days, fresh }));
    }
    return NextResponse.json(await loadSuggestedActions(authz.actor, userId!, days));
  } catch (error) {
    if (error instanceof SuggestedActionsError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("[consultant-workspace suggested-actions]", error);
    return NextResponse.json({ error: "Falha ao montar as ações sugeridas" }, { status: 500 });
  }
}
