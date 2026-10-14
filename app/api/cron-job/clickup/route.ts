import { NextResponse } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { flushOutbox, processPendingEvents, reviveWebhooks, syncPublishResults } from "@/lib/clickup/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A cada minuto: refaz eventos do ClickUp que não terminaram, leva o resultado da publicação de volta
 * para a tarefa e manda a fila de retorno. De hora em hora, reativa webhook suspenso.
 */
export async function GET(request: Request) {
  const auth = assertCronAuthorized(request, "[clickup]");
  if (!auth.ok) return auth.response;
  const events = await processPendingEvents();
  const results = await syncPublishResults();
  const sent = await flushOutbox();
  if (new Date().getUTCMinutes() === 0) await reviveWebhooks();
  return NextResponse.json({ ok: true, events, results, sent });
}
