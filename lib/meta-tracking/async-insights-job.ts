/**
 * O job assíncrono de insights da Meta (§3 e §6 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * A consulta síncrona de insights tem teto de linhas: a Meta recusa o relatório
 * INTEIRO (erro 100, subcódigo 1487534) quando o resultado passaria dele. Para
 * períodos longos — os 13 meses do backfill — o caminho oficial é outro:
 * `POST /act_{id}/insights` devolve um `report_run_id`, o relatório é preparado
 * do lado da Meta e o resultado é lido depois.
 *
 * Este módulo é a ESPERA: criar, aguardar, reconhecer o fim e ler. Ele não sabe
 * falar HTTP — recebe portas e as chama —, que é o que permite exercitar aqui os
 * três comportamentos que ninguém consegue observar em produção sem esperar uma
 * madrugada: o job que falha, o relatório que expira e o job que nunca termina.
 *
 * ## As três regras que este módulo carrega
 *
 * 1. **Job que falha re-tenta a FATIA, não o relatório.** `Job Failed` e
 *    `Job Skipped` são definitivos para aquele `report_run_id`; insistir em
 *    lê-lo devolveria erro. A tentativa seguinte cria um relatório novo.
 * 2. **`report_run_id` expirado não é lido.** O relatório vive 30 dias; passado
 *    isso o id não vale mais, e ler dele devolveria erro ou — pior — vazio, que
 *    viraria buraco silencioso na série. Expirou, começa outro.
 * 3. **Prazo antes de paciência.** Um job que não termina segura a invocação
 *    inteira, e a invocação tem limite de duração na plataforma. Estourou o
 *    prazo, o erro sobe: a fatia não é marcada como coberta e a próxima
 *    invocação a refaz do começo, que é exatamente o que o progresso retomável
 *    existe para permitir.
 */

import {
  mergeQuotaUsage,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  assertDeadlineBudget,
  deadlineExceededFrom,
  MIN_EXTERNAL_OPERATION_BUDGET_MS,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import type { InsightsFetchResult } from "@/lib/meta-tracking/collect-daily-metrics";
import type { InsightsRange, RawInsightsRow } from "@/lib/meta-tracking/daily-metrics";
import type { TrackingCredentials } from "@/lib/meta-tracking/run-daily-collection";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

/** O que o `async_status` da Meta significa para quem está esperando. */
export type AsyncReportPhase = "running" | "completed" | "failed" | "skipped";

/** Validade do `report_run_id` documentada pela Meta. */
export const ASYNC_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Intervalo entre polls. Curto o bastante para não desperdiçar a invocação. */
export const DEFAULT_ASYNC_POLL_INTERVAL_MS = 5_000;

/** Um POST, ao menos um poll e uma espera curta antes de abrir um job caro. */
const MIN_ASYNC_REPORT_START_BUDGET_MS =
  DEFAULT_ASYNC_POLL_INTERVAL_MS * 2;

/**
 * Teto por tentativa. Na coleta diária ele é ainda limitado pelo deadline
 * absoluto restante; no backfill sem deadline global continua valendo inteiro.
 */
export const DEFAULT_ASYNC_POLL_TIMEOUT_MS = 180_000;

/**
 * Tentativas por fatia. Duas: a Meta falha um job por motivo transitório com
 * alguma frequência, e a terceira tentativa já é insistência — que custa taxa de
 * erro, e a licença do app é throttled por ela.
 */
export const DEFAULT_ASYNC_ATTEMPTS = 2;

/**
 * O status do relatório, como a Meta o reporta.
 *
 * Resposta ilegível conta como "ainda rodando" de propósito: inventar "falhou" a
 * partir de um formato que não se reconhece jogaria fora um relatório que talvez
 * estivesse a caminho. Quem decide desistir é o prazo, que é finito.
 */
export function readAsyncReportPhase(node: unknown): AsyncReportPhase {
  if (typeof node !== "object" || node === null) return "running";
  const status = (node as { async_status?: unknown }).async_status;
  if (typeof status !== "string") return "running";

  const normalized = status.trim().toLowerCase();
  if (normalized === "job completed") return "completed";
  if (normalized === "job failed") return "failed";
  if (normalized === "job skipped") return "skipped";
  return "running";
}

/** O relatório ainda pode ser lido, ou o id já perdeu a validade? */
export function isReportRunUsable(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() < ASYNC_REPORT_TTL_MS;
}

export type AsyncInsightsJobPorts = {
  /** `POST /act_{id}/insights` — devolve o `report_run_id`. */
  startReport: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    entityLevel: MetaTrackingEntityLevel;
    range: InsightsRange;
    deadline?: CollectionDeadline;
  }) => Promise<{ reportRunId: string; usage: QuotaUsage; apiCalls: number }>;
  /** `GET /{report_run_id}` — o nó de status, cru. */
  readReport: (args: {
    reportRunId: string;
    credentials: TrackingCredentials;
    deadline?: CollectionDeadline;
  }) => Promise<{ node: unknown; usage: QuotaUsage; apiCalls: number }>;
  /** `GET /{report_run_id}/insights` — as linhas, já paginadas. */
  fetchReportRows: (args: {
    reportRunId: string;
    credentials: TrackingCredentials;
    deadline?: CollectionDeadline;
  }) => Promise<{ rows: RawInsightsRow[]; usage: QuotaUsage; apiCalls: number }>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => Date;
};

export type RunAsyncInsightsReportArgs = {
  accountId: string;
  credentials: TrackingCredentials;
  entityLevel: MetaTrackingEntityLevel;
  range: InsightsRange;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  maxAttempts?: number;
  /** Deadline absoluto do run diário; ausente nos scripts sem limite global. */
  deadline?: CollectionDeadline;
};

/** Uma tentativa terminou sem linhas; a fatia pode ser tentada de novo. */
type AttemptOutcome =
  | { done: true; rows: RawInsightsRow[] }
  | { done: false; reason: string };

export async function runAsyncInsightsReport(
  ports: AsyncInsightsJobPorts,
  args: RunAsyncInsightsReportArgs,
): Promise<InsightsFetchResult> {
  const pollIntervalMs = Math.max(
    1,
    args.pollIntervalMs ?? DEFAULT_ASYNC_POLL_INTERVAL_MS,
  );
  const pollTimeoutMs = Math.max(
    1,
    args.pollTimeoutMs ?? DEFAULT_ASYNC_POLL_TIMEOUT_MS,
  );
  const maxAttempts = Math.max(1, args.maxAttempts ?? DEFAULT_ASYNC_ATTEMPTS);

  let usage = UNKNOWN_QUOTA_USAGE;
  let apiCalls = 0;
  let lastReason = "sem resposta da Meta";

  const account = <T extends { usage: QuotaUsage; apiCalls: number }>(
    response: T,
  ): T => {
    usage = mergeQuotaUsage(usage, response.usage);
    apiCalls += response.apiCalls;
    return response;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertDeadlineBudget(
      args.deadline,
      "iniciar relatório assíncrono de insights",
      MIN_ASYNC_REPORT_START_BUDGET_MS,
    );
    // Erro de volume sobe intocado: quem encolhe o período é o passo de
    // métricas, e re-tentar o mesmo período grande demais é erro garantido.
    const started = account(
      await ports.startReport({
        accountId: args.accountId,
        credentials: args.credentials,
        entityLevel: args.entityLevel,
        range: args.range,
        deadline: args.deadline,
      }),
    );
    const startedAt = ports.now();

    const outcome = await awaitReport({
      ports,
      credentials: args.credentials,
      reportRunId: started.reportRunId,
      startedAt,
      pollIntervalMs,
      pollTimeoutMs,
      account,
      deadline: args.deadline,
    });

    if (outcome.done) return { rows: outcome.rows, usage, apiCalls };
    lastReason = outcome.reason;
  }

  throw new Error(
    `Job assíncrono de insights (${args.entityLevel}, ${args.range.since}…${args.range.until}) não completou após ${maxAttempts} tentativa(s): ${lastReason}`,
  );
}

async function awaitReport(args: {
  ports: AsyncInsightsJobPorts;
  credentials: TrackingCredentials;
  reportRunId: string;
  startedAt: Date;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  account: <T extends { usage: QuotaUsage; apiCalls: number }>(response: T) => T;
  deadline?: CollectionDeadline;
}): Promise<AttemptOutcome> {
  const { ports, reportRunId, startedAt, account } = args;

  for (;;) {
    const elapsedMs = ports.now().getTime() - startedAt.getTime();
    if (elapsedMs >= args.pollTimeoutMs) {
      throw new Error(
        `Job assíncrono de insights excedeu o prazo de ${Math.round(args.pollTimeoutMs / 1000)}s (relatório ${reportRunId})`,
      );
    }
    assertDeadlineBudget(
      args.deadline,
      "consultar status do relatório assíncrono",
      MIN_EXTERNAL_OPERATION_BUDGET_MS,
    );
    const status = account(
      await ports.readReport({
        reportRunId,
        credentials: args.credentials,
        deadline: args.deadline,
      }),
    );
    const phase = readAsyncReportPhase(status.node);

    if (phase === "failed" || phase === "skipped") {
      return { done: false, reason: `a Meta reportou "${phase}" (Job Failed/Skipped)` };
    }

    if (phase === "completed") {
      if (!isReportRunUsable(startedAt, ports.now())) {
        // Ler um relatório expirado devolve erro ou vazio; vazio viraria buraco
        // silencioso na série. Melhor pagar outro relatório.
        return { done: false, reason: "o report_run_id expirou antes da leitura" };
      }
      assertDeadlineBudget(
        args.deadline,
        "ler linhas do relatório assíncrono",
        MIN_EXTERNAL_OPERATION_BUDGET_MS,
      );
      const page = account(
        await ports.fetchReportRows({
          reportRunId,
          credentials: args.credentials,
          deadline: args.deadline,
        }),
      );
      return { done: true, rows: page.rows };
    }

    const remainingPollMs =
      args.pollTimeoutMs - (ports.now().getTime() - startedAt.getTime());
    if (remainingPollMs <= 0) {
      // Prazo estourado NÃO é re-tentativa: a fatia não é marcada como coberta e
      // a próxima invocação a refaz. Insistir aqui gastaria a invocação inteira.
      throw new Error(
        `Job assíncrono de insights excedeu o prazo de ${Math.round(args.pollTimeoutMs / 1000)}s (relatório ${reportRunId})`,
      );
    }

    const remainingDeadlineMs =
      args.deadline?.remainingWorkMs() ?? Number.POSITIVE_INFINITY;
    const sleepMs = Math.min(
      args.pollIntervalMs,
      remainingPollMs,
      remainingDeadlineMs,
    );
    if (sleepMs <= 0) {
      assertDeadlineBudget(args.deadline, "aguardar relatório assíncrono");
      throw new Error(
        `Job assíncrono de insights excedeu o prazo de ${Math.round(args.pollTimeoutMs / 1000)}s (relatório ${reportRunId})`,
      );
    }
    try {
      await ports.sleep(sleepMs, args.deadline?.signal);
    } catch (error) {
      const deadlineError = deadlineExceededFrom(
        args.deadline,
        "aguardar relatório assíncrono",
        error,
      );
      if (deadlineError) throw deadlineError;
      throw error;
    }
  }
}
