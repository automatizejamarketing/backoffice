/**
 * Deadline absoluto compartilhado por toda a coleta diária.
 *
 * O deadline de trabalho vence ANTES do prazo suave da invocação. O intervalo
 * restante é reservado exclusivamente para checkpoints de cobertura e para
 * fechar o run; a folga entre o prazo suave e o `maxDuration` da Vercel é uma
 * segunda barreira caso uma operação de banco já iniciada demore a devolver.
 */

export const DEFAULT_FINALIZATION_RESERVE_MS = 30_000;

/** Não abre uma conta nova sem tempo para ao menos uma passagem curta. */
export const MIN_ACCOUNT_START_BUDGET_MS = 30_000;

/** Margem mínima para iniciar uma chamada Graph ou etapa opcional. */
export const MIN_EXTERNAL_OPERATION_BUDGET_MS = 5_000;

/** Persistências em voo não são canceláveis; só começam com esta margem. */
export const MIN_PERSISTENCE_START_BUDGET_MS = 5_000;

export const COLLECTION_DEADLINE_ERROR_CODE = "COLLECTION_DEADLINE_EXCEEDED";

export class CollectionDeadlineExceededError extends Error {
  readonly code = COLLECTION_DEADLINE_ERROR_CODE;
  readonly stage: string;
  readonly deadlineAt: Date;
  readonly remainingMs: number;
  readonly minimumRequiredMs: number;

  constructor(args: {
    stage: string;
    deadlineAt: Date;
    remainingMs: number;
    minimumRequiredMs: number;
    cause?: unknown;
  }) {
    super(
      `Orçamento da coleta esgotado antes de ${args.stage}; ` +
        `restavam ${Math.max(0, Math.floor(args.remainingMs))}ms`,
      args.cause === undefined ? undefined : { cause: args.cause },
    );
    this.name = "CollectionDeadlineExceededError";
    this.stage = args.stage;
    this.deadlineAt = args.deadlineAt;
    this.remainingMs = args.remainingMs;
    this.minimumRequiredMs = args.minimumRequiredMs;
  }
}

export type CollectionDeadline = {
  /** Início único usado para derivar os dois deadlines absolutos. */
  readonly startedAt: Date;
  /** Depois deste instante nenhuma operação normal nova deve começar. */
  readonly workDeadlineAt: Date;
  /** Prazo suave total; o trecho final é exclusivo para finalização. */
  readonly finalizationDeadlineAt: Date;
  /** Abortado exatamente no deadline de trabalho para interromper `fetch`. */
  readonly signal: AbortSignal;
  now: () => Date;
  remainingWorkMs: () => number;
  remainingFinalizationMs: () => number;
  dispose: () => void;
};

export function createCollectionDeadline(args: {
  startedAt: Date;
  timeoutMs: number;
  finalizationReserveMs?: number;
  now: () => Date;
}): CollectionDeadline {
  const timeoutMs = Math.max(1_000, Math.floor(args.timeoutMs));
  const requestedReserve = Math.max(
    0,
    Math.floor(args.finalizationReserveMs ?? DEFAULT_FINALIZATION_RESERVE_MS),
  );
  // Sempre conserva ao menos 1 s de trabalho, inclusive em testes com prazo
  // artificialmente curto.
  const finalizationReserveMs = Math.min(requestedReserve, timeoutMs - 1_000);
  const finalizationDeadlineAt = new Date(args.startedAt.getTime() + timeoutMs);
  const workDeadlineAt = new Date(
    finalizationDeadlineAt.getTime() - finalizationReserveMs,
  );
  const controller = new AbortController();
  const delayMs = Math.max(0, workDeadlineAt.getTime() - args.now().getTime());
  const timer = setTimeout(() => {
    controller.abort(
      new CollectionDeadlineExceededError({
        stage: "continuar trabalho",
        deadlineAt: workDeadlineAt,
        remainingMs: 0,
        minimumRequiredMs: 1,
      }),
    );
  }, delayMs);
  // O timer de segurança não deve manter scripts manuais vivos depois que o
  // run já terminou.
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

  return {
    startedAt: new Date(args.startedAt),
    workDeadlineAt,
    finalizationDeadlineAt,
    signal: controller.signal,
    now: args.now,
    remainingWorkMs: () => workDeadlineAt.getTime() - args.now().getTime(),
    remainingFinalizationMs: () =>
      finalizationDeadlineAt.getTime() - args.now().getTime(),
    dispose: () => clearTimeout(timer),
  };
}

export function hasDeadlineBudget(
  deadline: CollectionDeadline | undefined,
  minimumRequiredMs = 1,
): boolean {
  if (!deadline) return true;
  return (
    !deadline.signal.aborted &&
    deadline.remainingWorkMs() >= Math.max(1, minimumRequiredMs)
  );
}

export function assertDeadlineBudget(
  deadline: CollectionDeadline | undefined,
  stage: string,
  minimumRequiredMs = 1,
): void {
  if (!deadline) return;
  const required = Math.max(1, minimumRequiredMs);
  const remainingMs = deadline.remainingWorkMs();
  if (!deadline.signal.aborted && remainingMs >= required) return;

  throw new CollectionDeadlineExceededError({
    stage,
    deadlineAt: deadline.workDeadlineAt,
    remainingMs,
    minimumRequiredMs: required,
    cause: deadline.signal.aborted ? deadline.signal.reason : undefined,
  });
}

export function deadlineExceededFrom(
  deadline: CollectionDeadline | undefined,
  stage: string,
  error: unknown,
): CollectionDeadlineExceededError | null {
  if (!deadline) return null;
  if (!deadline.signal.aborted && deadline.remainingWorkMs() > 0) return null;
  return new CollectionDeadlineExceededError({
    stage,
    deadlineAt: deadline.workDeadlineAt,
    remainingMs: deadline.remainingWorkMs(),
    minimumRequiredMs: 1,
    cause: error,
  });
}

export function isCollectionDeadlineExceeded(
  error: unknown,
): error is CollectionDeadlineExceededError {
  return (
    error instanceof CollectionDeadlineExceededError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === COLLECTION_DEADLINE_ERROR_CODE)
  );
}
