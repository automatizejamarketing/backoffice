/**
 * A leitura de operação da fundação de tracking (§9 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Costura pura: recebe as linhas cruas de `meta_tracking_runs` e de
 * `meta_tracking_account_coverage` e devolve o que o operador precisa ver —
 * execução completa × parcial × falha, e a grade conta×dia com os buracos e as
 * contas em reconexão pendente em destaque.
 *
 * Por que aqui e não em SQL: buraco de cobertura é *ausência* de linha, e
 * ausência não se agrega — precisa da grade de dias explícita para virar
 * informação. Além disso, a mesma decisão serve à tela e a qualquer alerta
 * futuro; se estivesse na consulta, cada consumidor reinventaria a sua.
 *
 * Sem I/O, sem `lib/db` a não ser dos *tipos* do schema.
 */

import {
  canAccessMarketingUser,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
import { shiftDayKey, type DayKey } from "@/lib/meta-tracking/correlation";
import type {
  MetaTrackingCoverageStatus,
  MetaTrackingRunKind,
  MetaTrackingRunStatus,
  MetaTrackingRunTriggeredBy,
} from "@/lib/db/schema";

/**
 * Como o operador lê uma execução. `partial` é o `completed_with_errors` do
 * banco: a execução terminou, mas alguma conta ficou pelo caminho — é diferente
 * de `failed`, em que a execução inteira morreu.
 */
export type TrackingRunOutcome = "running" | "complete" | "partial" | "failed";

/**
 * Os contadores do `summary` jsonb. Todos opcionais na origem: o default da
 * tabela traz um subconjunto e o orquestrador escreve o conjunto completo só ao
 * fechar o run.
 */
export type TrackingRunCounters = {
  usersConsidered: number;
  accountsCovered: number;
  accountsPartial: number;
  accountsFailed: number;
  accountsSkipped: number;
  accountsAlreadyCovered: number;
  entitiesSeen: number;
  versionsCreated: number;
  eventsCreated: number;
  versionsConfirmed: number;
  /**
   * Ações internas que a coleta reconheceu em vez de duplicar. Maior que zero é
   * a prova de que a deduplicação do ticket 07 está funcionando.
   */
  eventsLinked: number;
  metricRowsUpserted: number;
  /** Diferente de zero = alguma conta está encostando no teto de linhas da Meta. */
  metricSlicesDegraded: number;
  /** Snapshots de criativo gravados — foto única, nunca rebuscada. */
  creativesFetched: number;
  /**
   * Criativos que continuam sem snapshot. Normal enquanto o passivo de uma
   * conta recém-ativada drena; teimoso é sinal de lote recusado pela Meta.
   */
  creativesPending: number;
};

const COUNTER_KEYS = [
  "usersConsidered",
  "accountsCovered",
  "accountsPartial",
  "accountsFailed",
  "accountsSkipped",
  "accountsAlreadyCovered",
  "entitiesSeen",
  "versionsCreated",
  "eventsCreated",
  "versionsConfirmed",
  "eventsLinked",
  "metricRowsUpserted",
  "metricSlicesDegraded",
  "creativesFetched",
  "creativesPending",
] as const satisfies readonly (keyof TrackingRunCounters)[];

export type TrackingRunRow = {
  id: string;
  kind: MetaTrackingRunKind;
  triggeredBy: MetaTrackingRunTriggeredBy;
  status: MetaTrackingRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  /** `jsonb` — chega como `unknown` e é lido defensivamente. */
  summary: unknown;
};

export type TrackingRunView = {
  id: string;
  kind: MetaTrackingRunKind;
  triggeredBy: MetaTrackingRunTriggeredBy;
  status: MetaTrackingRunStatus;
  outcome: TrackingRunOutcome;
  inProgress: boolean;
  startedAt: Date;
  completedAt: Date | null;
  /** Fechada quando terminou; decorrida até `now` enquanto roda. */
  durationMs: number;
  counters: TrackingRunCounters;
  errorMessage: string | null;
};

const OUTCOME_BY_STATUS: Record<MetaTrackingRunStatus, TrackingRunOutcome> = {
  running: "running",
  completed: "complete",
  completed_with_errors: "partial",
  failed: "failed",
};

/**
 * Só número inteiro finito conta. `"18"` não vira 18 de propósito: o summary é
 * jsonb e um valor com o tipo errado é sinal de escrita quebrada, não de valor
 * a exibir — melhor mostrar zero do que um número que ninguém escreveu.
 */
function readCounter(summary: unknown, key: string): number {
  if (typeof summary !== "object" || summary === null) return 0;
  const value = (summary as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readTrackingRunCounters(summary: unknown): TrackingRunCounters {
  const counters = {} as TrackingRunCounters;
  for (const key of COUNTER_KEYS) {
    counters[key] = readCounter(summary, key);
  }
  return counters;
}

/**
 * Os `days` dias de calendário que terminam em `endDay`, em ordem crescente —
 * as colunas da grade de cobertura.
 */
export function coverageDayRange(endDay: DayKey, days: number): DayKey[] {
  const total = Math.max(1, Math.trunc(days));
  return Array.from({ length: total }, (_, index) =>
    shiftDayKey(endDay, index - (total - 1)),
  );
}

/**
 * `missing` é a ausência de linha: ninguém sequer tentou aquele dia, e a
 * configuração dele não existe em lugar nenhum para ser buscada depois.
 * `untracked` é o antes: a conta ainda não estava no tracking, o que não é
 * buraco nenhum.
 */
export type CoverageCellStatus =
  | MetaTrackingCoverageStatus
  | "missing"
  | "untracked";

/** Sem token não há coleta — e o buraco cresce a cada dia que ninguém aciona o cliente. */
function isReconnectStatus(status: CoverageCellStatus): boolean {
  return status === "skipped_reconnect" || status === "skipped_no_token";
}

export type CoverageRow = {
  accountId: string;
  userId: string;
  userEmail: string | null;
  businessDate: DayKey;
  status: MetaTrackingCoverageStatus;
  errorMessage: string | null;
  entitiesSeen: number;
  currency: string | null;
  timezoneName: string | null;
  completedAt: Date | null;
};

/**
 * A tela é global, mas o RBAC de marketing não é: um consultor só responde
 * pelos clientes atribuídos a ele. A regra é a mesma de qualquer rota de
 * marketing (`canAccessMarketingUser`) — reusada, e não reescrita, para que a
 * tela não possa discordar das rotas.
 */
export function filterCoverageRowsForActor<T extends { userId: string }>(
  rows: readonly T[],
  actor: BackofficeActor,
): T[] {
  return rows.filter((row) => canAccessMarketingUser(actor, row.userId));
}

export type CoverageCell = {
  day: DayKey;
  status: CoverageCellStatus;
  entitiesSeen: number;
  errorMessage: string | null;
  completedAt: Date | null;
};

export type CoverageAccountView = {
  accountId: string;
  userId: string;
  userEmail: string | null;
  currency: string | null;
  timezoneName: string | null;
  cells: CoverageCell[];
  daysComplete: number;
  /** Dias em que a conta estava no tracking e o dia não fechou completo. */
  daysIncomplete: number;
  /** Subconjunto de `daysIncomplete`: dias sem linha nenhuma. */
  daysMissing: number;
  needsReconnect: boolean;
  lastCompleteDay: DayKey | null;
  lastErrorMessage: string | null;
};

export type CoverageGridView = {
  days: DayKey[];
  accounts: CoverageAccountView[];
  totals: {
    accounts: number;
    accountsNeedingReconnect: number;
    accountsWithHoles: number;
    daysComplete: number;
    daysIncomplete: number;
  };
};

/**
 * A grade conta×dia. Ordenada pelo que exige ação: primeiro quem perdeu o
 * token (buraco que cresce sozinho), depois quem tem mais dias incompletos.
 */
export function buildCoverageGrid(input: {
  rows: readonly CoverageRow[];
  days: readonly DayKey[];
}): CoverageGridView {
  const days = [...input.days];
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const byAccount = new Map<
    string,
    { rows: CoverageRow[]; firstTrackedDay: DayKey }
  >();

  for (const row of input.rows) {
    const existing = byAccount.get(row.accountId);
    if (!existing) {
      byAccount.set(row.accountId, {
        rows: [row],
        firstTrackedDay: row.businessDate,
      });
      continue;
    }
    existing.rows.push(row);
    // Uma linha fora da faixa não vira célula, mas ainda prova que a conta já
    // estava sendo coletada antes — o que transforma o silêncio em buraco.
    if (row.businessDate < existing.firstTrackedDay) {
      existing.firstTrackedDay = row.businessDate;
    }
  }

  const accounts: CoverageAccountView[] = [];

  for (const [accountId, group] of byAccount) {
    const rowByDay = new Map<DayKey, CoverageRow>();
    for (const row of group.rows) {
      if (dayIndex.has(row.businessDate)) rowByDay.set(row.businessDate, row);
    }

    // O identificador da conta é o mesmo em todas as linhas; moeda e timezone
    // podem faltar nas linhas sem token, então vale a mais recente que tiver.
    const sortedRows = [...group.rows].sort((a, b) =>
      a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0,
    );
    const latestRow = sortedRows[0]!;

    const cells: CoverageCell[] = days.map((day) => {
      const row = rowByDay.get(day);
      if (row) {
        return {
          day,
          status: row.status,
          entitiesSeen: row.entitiesSeen,
          errorMessage: row.errorMessage,
          completedAt: row.completedAt,
        };
      }
      return {
        day,
        status: day < group.firstTrackedDay ? "untracked" : "missing",
        entitiesSeen: 0,
        errorMessage: null,
        completedAt: null,
      };
    });

    let daysComplete = 0;
    let daysIncomplete = 0;
    let daysMissing = 0;
    let lastCompleteDay: DayKey | null = null;

    for (const cell of cells) {
      if (cell.status === "untracked") continue;
      if (cell.status === "complete") {
        daysComplete += 1;
        lastCompleteDay = cell.day;
        continue;
      }
      daysIncomplete += 1;
      if (cell.status === "missing") daysMissing += 1;
    }

    const needsReconnect = cells.some((cell) => isReconnectStatus(cell.status));

    const lastErrorMessage =
      sortedRows.find((row) => row.errorMessage)?.errorMessage ?? null;

    accounts.push({
      accountId,
      userId: latestRow.userId,
      userEmail: latestRow.userEmail,
      currency: sortedRows.find((row) => row.currency)?.currency ?? null,
      timezoneName:
        sortedRows.find((row) => row.timezoneName)?.timezoneName ?? null,
      cells,
      daysComplete,
      daysIncomplete,
      daysMissing,
      needsReconnect,
      lastCompleteDay,
      lastErrorMessage,
    });
  }

  accounts.sort((a, b) => {
    if (a.needsReconnect !== b.needsReconnect) return a.needsReconnect ? -1 : 1;
    if (a.daysIncomplete !== b.daysIncomplete) {
      return b.daysIncomplete - a.daysIncomplete;
    }
    return a.accountId.localeCompare(b.accountId);
  });

  return {
    days,
    accounts,
    totals: {
      accounts: accounts.length,
      accountsNeedingReconnect: accounts.filter((a) => a.needsReconnect).length,
      accountsWithHoles: accounts.filter((a) => a.daysIncomplete > 0).length,
      daysComplete: accounts.reduce((sum, a) => sum + a.daysComplete, 0),
      daysIncomplete: accounts.reduce((sum, a) => sum + a.daysIncomplete, 0),
    },
  };
}

/**
 * As mesmas vistas com os instantes em ISO — o que a página serializa para o
 * componente cliente. Derivadas das originais de propósito: campo novo na vista
 * aparece automaticamente do outro lado, em vez de silenciosamente sumir.
 */
export type SerializedTrackingRunView = Omit<
  TrackingRunView,
  "startedAt" | "completedAt"
> & {
  startedAt: string;
  completedAt: string | null;
};

export type SerializedCoverageCell = Omit<CoverageCell, "completedAt"> & {
  completedAt: string | null;
};

export type SerializedCoverageAccount = Omit<CoverageAccountView, "cells"> & {
  cells: SerializedCoverageCell[];
};

export type SerializedCoverageGrid = Omit<CoverageGridView, "accounts"> & {
  accounts: SerializedCoverageAccount[];
};

export function serializeTrackingRuns(
  runs: readonly TrackingRunView[],
): SerializedTrackingRunView[] {
  return runs.map((run) => ({
    ...run,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  }));
}

export function serializeCoverageGrid(
  grid: CoverageGridView,
): SerializedCoverageGrid {
  return {
    ...grid,
    accounts: grid.accounts.map((account) => ({
      ...account,
      cells: account.cells.map((cell) => ({
        ...cell,
        completedAt: cell.completedAt?.toISOString() ?? null,
      })),
    })),
  };
}

export function summarizeTrackingRun(
  run: TrackingRunRow,
  now: Date = new Date(),
): TrackingRunView {
  const outcome = OUTCOME_BY_STATUS[run.status] ?? "running";
  const endedAt = run.completedAt ?? now;

  return {
    id: run.id,
    kind: run.kind,
    triggeredBy: run.triggeredBy,
    status: run.status,
    outcome,
    inProgress: run.completedAt === null && run.status === "running",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: Math.max(0, endedAt.getTime() - run.startedAt.getTime()),
    counters: readTrackingRunCounters(run.summary),
    errorMessage: run.errorMessage,
  };
}
