import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { OutreachError, previewOutreach, sendOutreach } from "@/lib/consultant-workspace/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST { mode: "preview" | "send", userId, kind, title, message, entity? }
 *
 * Prévia ou envio de mensagem da Mat ao cliente, encaminhado servidor a
 * servidor ao app. O e-mail do gestor sai da sessão, nunca do corpo.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input", message: "JSON inválido" }, { status: 400 });
  }
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:write");
  if (!authz.ok) return authz.response;
  const { mode, ...input } = body;
  try {
    const result =
      mode === "send" ? await sendOutreach(authz.actor, input, "backoffice") : await previewOutreach(authz.actor, input);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OutreachError) {
      const { failure } = error;
      return NextResponse.json(
        { ok: false, error: failure.code, message: failure.message, lastSentAt: failure.lastSentAt ?? null },
        { status: failure.status },
      );
    }
    console.error("[consultant-workspace outreach]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "unexpected",
        message:
          mode === "send"
            ? "Falha inesperada no envio. Confira o histórico do cliente antes de tentar de novo."
            : "Falha inesperada na prévia.",
      },
      { status: 500 },
    );
  }
}
