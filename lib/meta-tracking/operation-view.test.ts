import { describe, expect, test } from "bun:test";

import {
  buildCoverageGrid,
  coverageDayRange,
  filterCoverageRowsForActor,
  summarizeTrackingRun,
  type CoverageRow,
} from "@/lib/meta-tracking/operation-view";

const RUN_BASE = {
  id: "run-1",
  kind: "daily" as const,
  triggeredBy: "cron" as const,
  status: "completed" as const,
  startedAt: new Date("2026-08-09T08:00:00.000Z"),
  completedAt: new Date("2026-08-09T08:04:12.000Z"),
  errorMessage: null,
  summary: {
    usersConsidered: 12,
    accountsCovered: 18,
    accountsPartial: 1,
    accountsFailed: 0,
    accountsSkipped: 2,
    accountsAlreadyCovered: 4,
    entitiesSeen: 340,
    versionsCreated: 7,
    eventsCreated: 9,
    versionsConfirmed: 333,
    eventsLinked: 2,
    metricRowsUpserted: 9520,
    metricSlicesDegraded: 0,
  },
};

describe("summarizeTrackingRun", () => {
  test("execução sem erro é completa e traz a duração fechada", () => {
    const view = summarizeTrackingRun(RUN_BASE);

    expect(view.outcome).toBe("complete");
    expect(view.inProgress).toBe(false);
    expect(view.durationMs).toBe(252_000);
    expect(view.counters.accountsCovered).toBe(18);
    expect(view.counters.metricRowsUpserted).toBe(9520);
    expect(view.counters.eventsLinked).toBe(2);
  });

  test("execução com erros parciais é parcial, não falha", () => {
    const view = summarizeTrackingRun({
      ...RUN_BASE,
      status: "completed_with_errors",
      summary: { ...RUN_BASE.summary, accountsFailed: 3 },
    });

    expect(view.outcome).toBe("partial");
    expect(view.counters.accountsFailed).toBe(3);
  });

  test("execução falha carrega a mensagem de erro", () => {
    const view = summarizeTrackingRun({
      ...RUN_BASE,
      status: "failed",
      errorMessage: "token keyring indisponível",
    });

    expect(view.outcome).toBe("failed");
    expect(view.errorMessage).toBe("token keyring indisponível");
  });

  test("execução em andamento mede o tempo decorrido até agora", () => {
    const view = summarizeTrackingRun(
      { ...RUN_BASE, status: "running", completedAt: null },
      new Date("2026-08-09T08:01:30.000Z"),
    );

    expect(view.outcome).toBe("running");
    expect(view.inProgress).toBe(true);
    expect(view.durationMs).toBe(90_000);
  });

  test("summary com chaves ausentes ou de outro tipo vira zero, nunca NaN", () => {
    const view = summarizeTrackingRun({
      ...RUN_BASE,
      summary: { accountsCovered: "18", entitiesSeen: 5 },
    });

    expect(view.counters.accountsCovered).toBe(0);
    expect(view.counters.entitiesSeen).toBe(5);
    expect(view.counters.versionsCreated).toBe(0);
  });
});

const DAYS = coverageDayRange("2026-08-09", 5);

function coverageRow(overrides: Partial<CoverageRow>): CoverageRow {
  return {
    accountId: "act_1",
    userId: "user-1",
    userEmail: "cliente@exemplo.com",
    businessDate: "2026-08-09",
    status: "complete",
    errorMessage: null,
    entitiesSeen: 12,
    currency: "BRL",
    timezoneName: "America/Sao_Paulo",
    completedAt: new Date("2026-08-09T08:03:00.000Z"),
    ...overrides,
  };
}

describe("coverageDayRange", () => {
  test("devolve os N dias terminando no dia pedido, em ordem", () => {
    expect(coverageDayRange("2026-08-09", 3)).toEqual([
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });
});

describe("buildCoverageGrid", () => {
  test("dia sem linha de cobertura vira buraco visível na grade", () => {
    const grid = buildCoverageGrid({
      days: DAYS,
      rows: [
        coverageRow({ businessDate: "2026-08-05" }),
        coverageRow({ businessDate: "2026-08-06" }),
        // 2026-08-07 nunca foi coletado — o buraco
        coverageRow({ businessDate: "2026-08-08" }),
        coverageRow({ businessDate: "2026-08-09" }),
      ],
    });

    const account = grid.accounts[0]!;
    expect(account.cells.map((cell) => cell.status)).toEqual([
      "complete",
      "complete",
      "missing",
      "complete",
      "complete",
    ]);
    expect(account.daysComplete).toBe(4);
    expect(account.daysIncomplete).toBe(1);
    expect(account.daysMissing).toBe(1);
    expect(account.lastCompleteDay).toBe("2026-08-09");
  });

  test("dias anteriores à primeira coleta da conta não são buraco — a conta ainda não existia no tracking", () => {
    const grid = buildCoverageGrid({
      days: DAYS,
      rows: [
        coverageRow({ businessDate: "2026-08-08" }),
        coverageRow({ businessDate: "2026-08-09" }),
      ],
    });

    const account = grid.accounts[0]!;
    expect(account.cells.map((cell) => cell.status)).toEqual([
      "untracked",
      "untracked",
      "untracked",
      "complete",
      "complete",
    ]);
    expect(account.daysIncomplete).toBe(0);
    expect(account.daysMissing).toBe(0);
  });

  test("conta em reconexão pendente vem em destaque, antes das demais", () => {
    const grid = buildCoverageGrid({
      days: DAYS,
      rows: [
        coverageRow({ accountId: "act_saudavel", businessDate: "2026-08-05" }),
        coverageRow({ accountId: "act_saudavel", businessDate: "2026-08-06" }),
        coverageRow({ accountId: "act_saudavel", businessDate: "2026-08-07" }),
        coverageRow({ accountId: "act_saudavel", businessDate: "2026-08-08" }),
        coverageRow({ accountId: "act_saudavel", businessDate: "2026-08-09" }),
        coverageRow({ accountId: "act_quebrado", businessDate: "2026-08-05" }),
        coverageRow({
          accountId: "act_quebrado",
          businessDate: "2026-08-09",
          status: "skipped_reconnect",
          errorMessage: "Token inválido: reconexão pendente",
          entitiesSeen: 0,
          completedAt: null,
        }),
      ],
    });

    expect(grid.accounts.map((account) => account.accountId)).toEqual([
      "act_quebrado",
      "act_saudavel",
    ]);

    const broken = grid.accounts[0]!;
    expect(broken.needsReconnect).toBe(true);
    expect(broken.lastErrorMessage).toBe("Token inválido: reconexão pendente");
    expect(broken.lastCompleteDay).toBe("2026-08-05");
    expect(broken.daysMissing).toBe(3);
    expect(grid.totals.accountsNeedingReconnect).toBe(1);
    expect(grid.totals.accountsWithHoles).toBe(1);
  });

  test("dia parcial conta como incompleto, mas não como buraco silencioso", () => {
    const grid = buildCoverageGrid({
      days: coverageDayRange("2026-08-09", 1),
      rows: [
        coverageRow({
          businessDate: "2026-08-09",
          status: "partial",
          errorMessage: "Cota da conta acima do limiar",
        }),
      ],
    });

    const account = grid.accounts[0]!;
    expect(account.cells[0]!.status).toBe("partial");
    expect(account.daysIncomplete).toBe(1);
    expect(account.daysMissing).toBe(0);
    expect(account.lastCompleteDay).toBeNull();
  });

  test("sem nenhuma cobertura registrada a grade nasce vazia, com os dias mesmo assim", () => {
    const grid = buildCoverageGrid({ days: DAYS, rows: [] });

    expect(grid.accounts).toEqual([]);
    expect(grid.days).toEqual(DAYS);
    expect(grid.totals.accounts).toBe(0);
  });

  test("linha fora da faixa de dias é ignorada pela grade", () => {
    const grid = buildCoverageGrid({
      days: coverageDayRange("2026-08-09", 2),
      rows: [
        coverageRow({ businessDate: "2026-07-01" }),
        coverageRow({ businessDate: "2026-08-09" }),
      ],
    });

    const account = grid.accounts[0]!;
    expect(account.cells).toHaveLength(2);
    expect(account.cells.map((cell) => cell.day)).toEqual([
      "2026-08-08",
      "2026-08-09",
    ]);
    // A linha de julho ainda é a primeira coleta conhecida: 08 é buraco, não
    // "conta nova".
    expect(account.cells[0]!.status).toBe("missing");
  });
});

describe("filterCoverageRowsForActor", () => {
  const rows = [
    coverageRow({ accountId: "act_1", userId: "user-1" }),
    coverageRow({ accountId: "act_2", userId: "user-2" }),
  ];

  test("admin vê a cobertura de toda a base", () => {
    const visible = filterCoverageRowsForActor(rows, {
      id: "a",
      email: "admin@exemplo.com",
      role: "admin",
      source: "database",
    });

    expect(visible.map((row) => row.accountId)).toEqual(["act_1", "act_2"]);
  });

  test("consultor só vê a cobertura dos clientes atribuídos a ele", () => {
    const visible = filterCoverageRowsForActor(rows, {
      id: "c",
      email: "consultor@exemplo.com",
      role: "marketing_consultant",
      source: "database",
      assignedUserIds: ["user-2"],
    });

    expect(visible.map((row) => row.accountId)).toEqual(["act_2"]);
  });
});
