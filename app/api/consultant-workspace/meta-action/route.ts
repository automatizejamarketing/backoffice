import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { applyMetaChange, MetaActionError, previewMetaChange, type MetaChange } from "@/lib/consultant-workspace/meta-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { change, mode: "preview" | "apply" } — prévia (estado ao vivo na Meta)
 * ou execução pelas mesmas rotas da tela de Marketing.
 */
export async function POST(request: Request) {
  const { change, mode } = (await request.json()) as { change: MetaChange; mode?: "preview" | "apply" };
  const authz = await requireMarketingUserAccessResponse(change?.userId, "marketing:write");
  if (!authz.ok) return authz.response;
  try {
    if (mode === "apply") return NextResponse.json({ ok: true, ...(await applyMetaChange(authz.actor, change)) });
    return NextResponse.json({ ok: true, preview: await previewMetaChange(authz.actor, change) });
  } catch (error) {
    if (error instanceof MetaActionError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error("[consultant-workspace meta-action]", error);
    return NextResponse.json({ ok: false, error: "Falha ao falar com a Meta" }, { status: 502 });
  }
}
