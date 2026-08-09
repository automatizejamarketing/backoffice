import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { createDailyCollectionPorts } from "@/lib/meta-tracking/daily-collection-ports";
import { runDailyTrackingCollection } from "@/lib/meta-tracking/run-daily-collection";

export const maxDuration = 300;

/**
 * Coleta diária de configuração das contas Meta conectadas (§5 e §10 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Roda na janela de madrugada (08:00–10:40 UTC ≈ 05:00–07:40 BRT), fora da
 * janela 11:00–12:15 UTC dos crons de negócio. Cada disparo drena um LOTE de
 * contas e para com folga do limite de duração da plataforma; o disparo
 * seguinte encontra as contas ainda pendentes pela cobertura conta×dia e
 * continua de onde parou. Rodar duas vezes no mesmo dia não duplica nada —
 * a conta já coberta é pulada e, quando reprocessada, a configuração idêntica
 * só atualiza `last_confirmed_at`.
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[meta-tracking-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await runDailyTrackingCollection(
      createDailyCollectionPorts(),
      { triggeredBy: "cron", onlyStale: true },
    );

    console.log("[meta-tracking-cron] completed", {
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      accountsProcessed: result.accountsProcessed,
      accountsCovered: result.accountsCovered,
      accountsPartial: result.accountsPartial,
      accountsSkipped: result.accountsSkipped,
      accountsFailed: result.accountsFailed,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      stoppedForBudget: result.stoppedForBudget,
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCovered: result.accountsCovered,
      accountsPartial: result.accountsPartial,
      accountsFailed: result.accountsFailed,
      accountsSkipped: result.accountsSkipped,
      accountsAlreadyCovered: result.accountsAlreadyCovered,
      entitiesSeen: result.entitiesSeen,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      versionsConfirmed: result.versionsConfirmed,
      /** Verdadeiro = ainda há base a cobrir; o próximo disparo continua. */
      stoppedForBudget: result.stoppedForBudget,
      // Primeiras falhas ajudam a diagnosticar sem despejar o lote inteiro.
      sampleErrors: result.errors.slice(0, 5),
    });
  } catch (error) {
    console.error("[meta-tracking-cron] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run meta tracking collection",
      },
      { status: 500 },
    );
  }
}
