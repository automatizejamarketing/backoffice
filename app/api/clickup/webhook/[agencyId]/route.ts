import { after, NextResponse } from "next/server";
import { processEvent, recordWebhook } from "@/lib/clickup/service";

export const dynamic = "force-dynamic";
/** O processamento roda depois da resposta: reler a tarefa e copiar até 10 artes (ou um vídeo). */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST do webhook do ClickUp (público; a prova é a assinatura `X-Signature` sobre o corpo cru).
 * Responde rápido (prazo de 7 s do ClickUp) e processa depois; o cron refaz o que falhar.
 * Nunca responde 401/410: o ClickUp suspende o webhook na hora com esses códigos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agencyId: string }> }) {
  const { agencyId } = await params;
  if (!UUID.test(agencyId)) return NextResponse.json({ ok: true });
  const raw = await request.text();
  const outcome = await recordWebhook(agencyId, raw, request.headers.get("x-signature"));
  if (outcome.newEventIds.length) {
    after(async () => {
      for (const id of outcome.newEventIds) await processEvent(id);
    });
  }
  return NextResponse.json({ ok: outcome.status === 200 }, { status: outcome.status });
}
