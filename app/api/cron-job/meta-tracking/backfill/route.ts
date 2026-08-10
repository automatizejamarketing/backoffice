import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { createBackfillPorts } from "@/lib/meta-tracking/backfill-ports";
import {
  describeBackfillSlice,
  runMetaTrackingBackfill,
} from "@/lib/meta-tracking/run-backfill";

export const maxDuration = 300;

/**
 * Contas do cliente que uma chamada pode percorrer. Não é orçamento de trabalho
 * (quem limita é o prazo) — é só o teto que impede o laço de varrer uma lista
 * absurda de contas dentro de uma invocação.
 */
const MAX_ACCOUNTS_PER_CALL = 50;

/**
 * Uma fatia de backfill do cliente X (§6 e §12/F4 do plano
 * `docs/plans/campaign-tracking-foundation.md`; ticket 10).
 *
 * ## Quem chama
 *
 * O workflow durável do frontend (`workflows/meta-tracking-backfill.ts`), que
 * nasce quando o cliente conclui a conexão com a Meta e chama esta rota em laço
 * até a resposta vir com `done: true`. O backfill precisa acontecer logo depois
 * da ativação — a janela de 37 meses da Meta desliza um dia por dia, e o que não
 * for capturado agora não volta —, mas não cabe numa invocação só: são treze
 * meses em três níveis, por relatório assíncrono.
 *
 * A rota é a MESMA orquestração do script manual (`scripts/backfill-meta-tracking.ts`),
 * com dois ajustes que só fazem sentido em plataforma:
 *
 * 1. **Prazo com folga para o relatório assíncrono.** O prazo do backfill é
 *    verificado ENTRE fatias, e uma fatia pode consumir mais 180 s esperando o
 *    relatório da Meta depois de começar (aviso 3 do ticket 05). 90 + 180 cabe
 *    nos 300 s; o default de 240 s do script não caberia. Na prática o prazo é o
 *    que faz cada chamada processar uma fatia (raramente duas), que é o
 *    "uma fatia por chamada" do ticket.
 * 2. **O teto de contas por chamada é alto.** Aqui o backfill é de UM cliente, e
 *    o laço sempre recomeça pela primeira conta dele: um teto baixo faria as
 *    contas já cobertas — que passam em milissegundos, sem fatia a fazer —
 *    consumirem todas as vagas e as últimas contas nunca chegarem a ser
 *    backfilladas. Quem limita a invocação é o prazo, não a contagem. Cliente
 *    com mais contas que `MAX_ACCOUNTS_PER_CALL` volta a ter o problema; nenhum
 *    tem hoje.
 *
 * O que NÃO é ajustado aqui: o orçamento de chamadas por conta. Ele já é por
 * invocação, e o backfill da conexão acontece de dia, fora da janela em que o
 * coletor diário disputa a mesma cota.
 *
 * ## Autenticação
 *
 * `Authorization: Bearer ${CRON_SECRET}`, como as demais rotas sob
 * `/api/cron-job` — que o `proxy.ts` bypassa da sessão do backoffice justamente
 * porque cada uma verifica o próprio chamador. Sem segredo configurado a rota
 * responde 500 e não executa nada.
 */
export async function POST(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[meta-tracking-backfill]");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!isUuid(userId)) {
    // Sem validar aqui, um `userId` torto viraria erro de cast do Postgres e um
    // 500 — que o workflow trataria como falha transitória e re-tentaria.
    return NextResponse.json(
      { error: "userId (uuid) é obrigatório" },
      { status: 400 },
    );
  }

  try {
    const result = await runMetaTrackingBackfill(createBackfillPorts(), {
      triggeredBy: "cron",
      userIds: [userId],
      maxAccounts: positiveInteger(body.maxAccounts) ?? MAX_ACCOUNTS_PER_CALL,
      softDeadlineMs: 90_000,
    });
    const outcome = describeBackfillSlice(result);

    console.log("[meta-tracking-backfill] slice", {
      userId,
      runId: result.runId,
      done: outcome.done,
      reason: outcome.reason,
      accountsProcessed: result.accountsProcessed,
      accountsSkippedByClaim: result.accountsSkippedByClaim,
      slicesCompleted: result.slicesCompleted,
      metricRowsUpserted: result.metricRowsUpserted,
      remainingDays: outcome.remainingDays,
    });

    return NextResponse.json({
      ok: true,
      /** `true` = não há mais fatia pendente; o chamador pode parar. */
      done: outcome.done,
      /** Por que parou (ou não) — `pending`, `target_covered`, `account_failed`… */
      reason: outcome.reason,
      /** Dias do alvo de 13 meses ainda não capturados nas contas tocadas. */
      remainingDays: outcome.remainingDays,
      runId: result.runId,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCompleted: result.accountsCompleted,
      accountsPartial: result.accountsPartial,
      accountsFailed: result.accountsFailed,
      /** Contas que outro disparo vivo já estava backfillando. */
      accountsSkippedByClaim: result.accountsSkippedByClaim,
      baselinesCreated: result.baselinesCreated,
      slicesCompleted: result.slicesCompleted,
      metricRowsUpserted: result.metricRowsUpserted,
      metricSlicesDegraded: result.metricSlicesDegraded,
      apiCallsUsed: result.apiCallsUsed,
      stoppedForBudget: result.stoppedForBudget,
      sampleErrors: result.errors.slice(0, 5),
    });
  } catch (error) {
    console.error("[meta-tracking-backfill] failed", { userId, error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run meta tracking backfill",
      },
      { status: 500 },
    );
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/** Corpo ausente ou ilegível vira objeto vazio — a validação reclama depois. */
async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
