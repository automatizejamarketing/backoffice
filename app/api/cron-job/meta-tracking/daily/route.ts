import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { createDailyCollectionPorts } from "@/lib/meta-tracking/daily-collection-ports";
import { runDailyTrackingCollection } from "@/lib/meta-tracking/run-daily-collection";

// 800 s é o máximo GA do plano Pro. O prazo interno fica em 600 s
// (`DEFAULT_SOFT_DEADLINE_MS`); a folga de 200 s deixa a pior conta única
// terminar e gravar a cobertura antes de a plataforma matar a invocação.
export const maxDuration = 800;

/**
 * Coleta diária de configuração das contas Meta conectadas (§5 e §10 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Roda na janela de madrugada (03:00–10:45 UTC ≈ 00:00–07:45 BRT, a cada
 * 15 min = 32 disparos), terminando antes da janela 11:00–12:15 UTC dos crons
 * de negócio — que falam com a MESMA Graph API e disputariam a cota. O
 * intervalo de 15 min é deliberadamente maior que o `maxDuration`: disparos
 * nunca se sobrepõem, e o claim de cobertura conta×dia não precisa ser
 * atômico. Cada disparo drena um LOTE de contas e para com folga do limite de
 * duração da plataforma; o disparo seguinte encontra as contas ainda
 * pendentes pela cobertura conta×dia e continua de onde parou. Rodar duas
 * vezes no mesmo dia não duplica nada — a conta já coberta é pulada e, quando
 * reprocessada, a configuração idêntica só atualiza `last_confirmed_at`.
 *
 * Dimensionamento (medido em staging, 2026-08-10): conta típica 11–15 s,
 * conta de ~2.400 entidades ~2 min. 32 disparos × 600 s ≈ 19.200 s por
 * madrugada ≈ 1.400 contas típicas — folga para uma base de 1.000.
 */
/**
 * Erros do lote despejados no log ao fim do disparo. Limitado porque num lote
 * de 40 contas quase tudo pode falhar de uma vez (ex.: banco fora) e o log
 * vira ruído; 50 cobre o lote inteiro com folga.
 */
const MAX_ERRORS_LOGGED = 50;

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[meta-tracking-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await runDailyTrackingCollection(
      createDailyCollectionPorts(),
      {
        triggeredBy: "cron",
        onlyStale: true,
        // O rastro por conta existe para o pós-morte: se a plataforma matar a
        // invocação no limite de duração, o último "coletando" sem o "→ status"
        // correspondente é a conta que morreu no meio — sem isso a invocação
        // morta não deixa vestígio nenhum no log.
        onAccountStart: ({ userEmail, accountId }) => {
          console.log("[meta-tracking-cron] coletando", { userEmail, accountId });
        },
        onProgress: (progress) => {
          if (progress.status === "complete") {
            console.log("[meta-tracking-cron] conta coberta", {
              userEmail: progress.userEmail,
              accountId: progress.accountId,
              metricRowsUpserted: progress.metricRowsUpserted,
            });
            return;
          }
          // Falha e parcial saem por `console.error` COM o erro cru: a
          // mensagem achatada basta para erro da Meta (o gateway já logou o
          // payload), mas exceção inesperada sem stack não tem causa raiz.
          console.error(
            "[meta-tracking-cron] conta não fechou",
            {
              userEmail: progress.userEmail,
              accountId: progress.accountId,
              status: progress.status,
              errorMessage: progress.errorMessage,
            },
            ...(progress.error !== undefined ? [progress.error] : []),
          );
        },
      },
    );

    // As mensagens completas, não só as contagens do summary: o corpo da
    // resposta de um cron não fica registrado em lugar nenhum — o log da
    // função é o único lugar onde a causa sobrevive.
    if (result.errors.length > 0) {
      console.error("[meta-tracking-cron] erros do lote", {
        total: result.errors.length,
        errors: result.errors.slice(0, MAX_ERRORS_LOGGED),
      });
    }

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
      metricRowsUpserted: result.metricRowsUpserted,
      creativesFetched: result.creativesFetched,
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
      /** Eventos crus do audit trail gravados neste disparo. */
      activityEventsUpserted: result.activityEventsUpserted,
      /** Ações que ganharam autor e horário exato do audit trail. */
      activityEventsMatched: result.activityEventsMatched,
      /** Dias da série diária inseridos ou atualizados neste disparo. */
      metricRowsUpserted: result.metricRowsUpserted,
      /** Acima de zero = alguma conta está encostando no teto de linhas. */
      metricSlicesDegraded: result.metricSlicesDegraded,
      /** Snapshots de criativo gravados neste disparo (foto única por criativo). */
      creativesFetched: result.creativesFetched,
      /** Criativos ainda sem snapshot; a próxima varredura os encontra de novo. */
      creativesPending: result.creativesPending,
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
