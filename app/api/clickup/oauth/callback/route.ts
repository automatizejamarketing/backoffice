import { NextResponse, type NextRequest } from "next/server";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { ClickupSetupError, completeOauth, readOauthState } from "@/lib/clickup/connect";

/** Volta do ClickUp: confere o `state`, troca o código pelo token e volta para a tela da agência. */
export async function GET(request: NextRequest) {
  const actor = await getCurrentBackofficeActor();
  if (!actor) return NextResponse.redirect(new URL("/login", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  let agencyId: string;
  try {
    agencyId = readOauthState(state, actor.id);
  } catch (error) {
    const back = new URL("/agencias", request.url);
    back.searchParams.set("erro", error instanceof Error ? error.message : "Link de conexão inválido.");
    return NextResponse.redirect(back);
  }
  const back = new URL(`/agencias/${agencyId}/clickup`, request.url);
  if (!code) {
    back.searchParams.set("erro", "A autorização foi cancelada no ClickUp.");
    return NextResponse.redirect(back);
  }
  try {
    await completeOauth(actor, agencyId, code);
    back.searchParams.set("conectado", "1");
  } catch (error) {
    console.error("[clickup] oauth", error);
    back.searchParams.set("erro", error instanceof ClickupSetupError ? error.message : "Não foi possível conectar o ClickUp. Tente de novo.");
  }
  return NextResponse.redirect(back);
}
