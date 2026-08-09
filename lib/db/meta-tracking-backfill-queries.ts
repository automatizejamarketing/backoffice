/**
 * O estado de retomada do backfill em Postgres (§6 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O. Quem decide o que capturar e o que já foi capturado é
 * `lib/meta-tracking/backfill-plan.ts`.
 *
 * ## Por que o progresso mora no `summary` do run
 *
 * O backfill precisa de estado por conta para retomar de onde parou, e a
 * fundação não tem tabela para isso — as sete tabelas do §4 não incluem uma, e
 * criar migration está vedado nesta feature (o `db:generate` deste repo está
 * quebrado desde antes; ver o ticket 01). As duas alternativas sem migration
 * eram esta e escrever em `meta_tracking_account_coverage`; a cobertura foi
 * descartada porque ela responde outra pergunta — "esta conta foi coletada NESTE
 * dia" — e é o claim do coletor diário: gravar lá o passado que o backfill
 * capturou diria que houve coleta de configuração em dias em que não houve.
 *
 * O `summary` é jsonb livre do run que fez o trabalho, e a chave `accounts`
 * guarda `{ covered: [{since, until}], baselineCompletedAt }` por conta. A
 * gravação é INCREMENTAL, fatia a fatia (`jsonb_set`), e não no fim: uma
 * invocação morta pela plataforma no meio de uma fatia perde a fatia, nunca a
 * noite.
 *
 * A migration desejada — uma tabela `meta_tracking_backfill_progress` com
 * unique `(account_id)` — está anotada no ticket 05 para a migration
 * consolidada futura.
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { metaTrackingRun, type MetaTrackingRunStatus } from "@/lib/db/schema";
import {
  EMPTY_BACKFILL_PROGRESS,
  mergeBackfillProgress,
  parseBackfillProgress,
  type BackfillAccountProgress,
} from "@/lib/meta-tracking/backfill-plan";

/**
 * Runs de backfill consultados ao montar o progresso de uma conta. O teto existe
 * para a consulta não crescer com a idade do sistema; contas reais acumulam
 * poucos runs com progresso, porque cada noite funde o que já havia.
 */
const MAX_PROGRESS_RUNS = 100;

/**
 * O que noites anteriores já cobriram nesta conta, fundido num progresso só.
 *
 * `jsonb_exists` em vez do operador `?`: o `?` literal é ambíguo para drivers
 * que o usam como placeholder — o mesmo motivo do coletor diário.
 */
export async function loadBackfillProgress(
  accountId: string,
): Promise<BackfillAccountProgress> {
  const rows = await db
    .select({
      progress: sql<unknown>`${metaTrackingRun.summary} -> 'accounts' -> ${accountId}::text`,
    })
    .from(metaTrackingRun)
    .where(
      and(
        eq(metaTrackingRun.kind, "backfill"),
        sql`jsonb_exists(coalesce(${metaTrackingRun.summary} -> 'accounts', '{}'::jsonb), ${accountId}::text)`,
      ),
    )
    .orderBy(desc(metaTrackingRun.startedAt))
    .limit(MAX_PROGRESS_RUNS);

  if (rows.length === 0) return { ...EMPTY_BACKFILL_PROGRESS };
  return mergeBackfillProgress(rows.map((row) => parseBackfillProgress(row.progress)));
}

/**
 * Checkpoint de uma conta no run corrente.
 *
 * O `||` com `jsonb_build_object` garante que `accounts` exista antes do
 * `jsonb_set` — `jsonb_set` cria só o ÚLTIMO nível do caminho, e sem isso o
 * primeiro checkpoint de um run seria silenciosamente perdido.
 *
 * O objeto gravado mistura duas escalas de tempo de propósito, e a leitura
 * precisa saber disso: `covered`/`baselineCompletedAt` são CUMULATIVOS (o
 * progresso da conta desde sempre, que é o que a retomada lê), enquanto
 * `slicesCompleted`/`metricRowsUpserted` são o que ESTE run fez — o contador por
 * conta que a tela de operação mostra ao lado do run.
 */
export async function saveBackfillProgress(args: {
  runId: string;
  accountId: string;
  progress: BackfillAccountProgress;
  counters: { slicesCompleted: number; metricRowsUpserted: number };
}): Promise<void> {
  await db
    .update(metaTrackingRun)
    .set({
      summary: sql`jsonb_set(
        coalesce(summary, '{}'::jsonb)
          || jsonb_build_object('accounts', coalesce(summary -> 'accounts', '{}'::jsonb)),
        ARRAY['accounts', ${args.accountId}::text],
        ${JSON.stringify({ ...args.progress, ...args.counters })}::jsonb,
        true
      )`,
    })
    .where(eq(metaTrackingRun.id, args.runId));
}

/**
 * Fecha o run do backfill somando os contadores ao que já está no `summary`.
 *
 * Difere do `finishTrackingRun` do coletor diário num ponto que é o motivo de
 * ele existir: aqui o `summary` é MESCLADO, não substituído. Substituir apagaria
 * o progresso por conta gravado durante a noite — e com ele a retomada.
 */
export async function finishBackfillRun(args: {
  runId: string;
  status: MetaTrackingRunStatus;
  summary: Record<string, number>;
  errorMessage: string | null;
}): Promise<void> {
  await db
    .update(metaTrackingRun)
    .set({
      status: args.status,
      completedAt: new Date(),
      errorMessage: args.errorMessage,
      summary: sql`coalesce(summary, '{}'::jsonb) || ${JSON.stringify(args.summary)}::jsonb`,
    })
    .where(eq(metaTrackingRun.id, args.runId));
}
