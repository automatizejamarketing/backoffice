import { describe, expect, test } from "bun:test";

import {
  ASYNC_REPORT_TTL_MS,
  isReportRunUsable,
  readAsyncReportPhase,
  runAsyncInsightsReport,
  type AsyncInsightsJobPorts,
} from "@/lib/meta-tracking/async-insights-job";
import {
  COLLECTION_DEADLINE_ERROR_CODE,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import { UNKNOWN_QUOTA_USAGE } from "@/lib/meta-tracking/quota-usage";
import {
  FIXTURE_ACCOUNT_ID,
  insightsDayV25,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";
import type { RawInsightsRow } from "@/lib/meta-tracking/daily-metrics";

const ARGS = {
  accountId: FIXTURE_ACCOUNT_ID,
  credentials: { accessToken: "token-de-teste" },
  entityLevel: "ad" as const,
  range: { since: "2026-01-01", until: "2026-01-31" },
};

/** O erro que a Meta devolve quando o relatório passaria do teto de linhas. */
function rowLimitError(): Error {
  const error = new Error("Please reduce the amount of data you're asking for");
  Object.assign(error, {
    errorReturn: { statusCode: 400, data: { code: 100, errorSubcode: 1487534 } },
  });
  return error;
}

type Trace = string[];

function makePorts(options: {
  /** Respostas do poll, na ordem; a última se repete se o poll insistir. */
  statuses: string[];
  rows?: RawInsightsRow[];
  startedAt?: Date;
  onStart?: (attempt: number) => void;
}): { ports: AsyncInsightsJobPorts; trace: Trace; clock: { value: Date } } {
  const trace: Trace = [];
  const clock = { value: options.startedAt ?? new Date("2026-08-09T05:00:00.000Z") };
  let attempt = 0;
  let poll = 0;

  const ports: AsyncInsightsJobPorts = {
    startReport: async () => {
      attempt += 1;
      options.onStart?.(attempt);
      const reportRunId = `report-${attempt}`;
      trace.push(`start:${reportRunId}`);
      return { reportRunId, usage: UNKNOWN_QUOTA_USAGE, apiCalls: 1 };
    },
    readReport: async ({ reportRunId }) => {
      const status = options.statuses[Math.min(poll, options.statuses.length - 1)];
      poll += 1;
      trace.push(`poll:${reportRunId}:${status}`);
      return {
        node: { id: reportRunId, async_status: status, async_percent_completion: 100 },
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      };
    },
    fetchReportRows: async ({ reportRunId }) => {
      trace.push(`rows:${reportRunId}`);
      return {
        rows: options.rows ?? [insightsDayV25()],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      };
    },
    sleep: async (ms) => {
      trace.push(`sleep:${ms}`);
      clock.value = new Date(clock.value.getTime() + ms);
    },
    now: () => clock.value,
  };

  return { ports, trace, clock };
}

describe("readAsyncReportPhase", () => {
  test("os status documentados da Meta viram as três decisões possíveis", () => {
    expect(readAsyncReportPhase({ async_status: "Job Completed" })).toBe("completed");
    expect(readAsyncReportPhase({ async_status: "Job Failed" })).toBe("failed");
    expect(readAsyncReportPhase({ async_status: "Job Skipped" })).toBe("skipped");
    expect(readAsyncReportPhase({ async_status: "Job Started" })).toBe("running");
    expect(readAsyncReportPhase({ async_status: "Job Running" })).toBe("running");
    expect(readAsyncReportPhase({ async_status: "Job Not Started" })).toBe("running");
  });

  test("resposta ilegível continua rodando: quem decide desistir é o prazo", () => {
    // Inventar "falhou" a partir de um formato que não se reconhece jogaria
    // fora um relatório que talvez estivesse a caminho.
    expect(readAsyncReportPhase(null)).toBe("running");
    expect(readAsyncReportPhase({})).toBe("running");
    expect(readAsyncReportPhase({ async_status: 7 })).toBe("running");
  });
});

describe("isReportRunUsable", () => {
  test("o relatório vale 30 dias — depois disso o id não pode mais ser lido", () => {
    const startedAt = new Date("2026-08-09T05:00:00.000Z");

    expect(
      isReportRunUsable(startedAt, new Date(startedAt.getTime() + 60_000)),
    ).toBe(true);
    expect(
      isReportRunUsable(startedAt, new Date(startedAt.getTime() + ASYNC_REPORT_TTL_MS - 1)),
    ).toBe(true);
    expect(
      isReportRunUsable(startedAt, new Date(startedAt.getTime() + ASYNC_REPORT_TTL_MS)),
    ).toBe(false);
  });
});

describe("runAsyncInsightsReport", () => {
  test("o relatório é criado, aguardado e lido — e as chamadas são contadas", async () => {
    const { ports, trace } = makePorts({
      statuses: ["Job Started", "Job Running", "Job Completed"],
    });

    const result = await runAsyncInsightsReport(ports, ARGS);

    expect(trace).toEqual([
      "start:report-1",
      "poll:report-1:Job Started",
      "sleep:5000",
      "poll:report-1:Job Running",
      "sleep:5000",
      "poll:report-1:Job Completed",
      "rows:report-1",
    ]);
    expect(result.rows).toHaveLength(1);
    // POST + 3 polls + 1 página de resultado.
    expect(result.apiCalls).toBe(5);
  });

  test("job que falha re-tenta a fatia com um relatório NOVO", async () => {
    let attemptsSeen = 0;
    const { ports, trace } = makePorts({
      statuses: ["Job Failed", "Job Completed"],
      onStart: () => {
        attemptsSeen += 1;
      },
    });

    const result = await runAsyncInsightsReport(ports, ARGS);

    expect(attemptsSeen).toBe(2);
    // Nada é lido do relatório que falhou — o id dele não é reaproveitado.
    expect(trace).not.toContain("rows:report-1");
    expect(trace).toContain("rows:report-2");
    expect(result.rows).toHaveLength(1);
  });

  test("job pulado pela Meta conta como falha e também é re-tentado", async () => {
    const { ports, trace } = makePorts({ statuses: ["Job Skipped", "Job Completed"] });

    await runAsyncInsightsReport(ports, ARGS);

    expect(trace).toContain("start:report-2");
  });

  test("falha em todas as tentativas reporta o erro com o status da Meta", async () => {
    const { ports } = makePorts({ statuses: ["Job Failed"] });

    await expect(runAsyncInsightsReport(ports, ARGS)).rejects.toThrow(
      /Job Failed|falhou/i,
    );
  });

  test("relatório que expirou não é lido: a fatia recomeça com um id novo", async () => {
    // O `report_run_id` expira (30 dias). Ler resultado de um relatório expirado
    // devolveria erro ou, pior, vazio — que viraria buraco silencioso na série.
    const { ports, trace, clock } = makePorts({ statuses: ["Job Completed"] });
    const original = ports.readReport;
    let firstPoll = true;
    ports.readReport = async (args) => {
      const response = await original(args);
      if (firstPoll) {
        firstPoll = false;
        // O relógio salta para além da validade enquanto o job rodava.
        clock.value = new Date(clock.value.getTime() + ASYNC_REPORT_TTL_MS + 60_000);
      }
      return response;
    };

    const result = await runAsyncInsightsReport(ports, ARGS);

    expect(trace).not.toContain("rows:report-1");
    expect(trace).toContain("start:report-2");
    expect(result.rows).toHaveLength(1);
  });

  test("job que nunca termina estoura o prazo em vez de segurar a invocação", async () => {
    const { ports, trace } = makePorts({ statuses: ["Job Running"] });

    await expect(
      runAsyncInsightsReport(ports, { ...ARGS, pollTimeoutMs: 30_000 }),
    ).rejects.toThrow(/prazo|timeout/i);

    // Nenhuma linha foi lida de um relatório que não completou.
    expect(trace.some((step) => step.startsWith("rows:"))).toBe(false);
    // E o prazo é respeitado: o poll não fica girando para sempre.
    expect(trace.filter((step) => step.startsWith("sleep:")).length).toBeLessThan(10);
  });

  test("o último sleep é limitado ao tempo restante do polling", async () => {
    const startedAt = new Date("2026-08-09T05:00:00.000Z");
    const { ports, trace, clock } = makePorts({
      statuses: ["Job Running"],
      startedAt,
    });

    await expect(
      runAsyncInsightsReport(ports, {
        ...ARGS,
        pollIntervalMs: 5_000,
        pollTimeoutMs: 12_000,
      }),
    ).rejects.toThrow(/prazo|timeout/i);

    expect(trace.filter((step) => step.startsWith("sleep:"))).toEqual([
      "sleep:5000",
      "sleep:5000",
      "sleep:2000",
    ]);
    expect(clock.value.getTime() - startedAt.getTime()).toBe(12_000);
  });

  test("job pendurado respeita o deadline absoluto e não abre nova tentativa", async () => {
    const startedAt = new Date("2026-08-09T05:00:00.000Z");
    const { ports, trace, clock } = makePorts({
      statuses: ["Job Running"],
      startedAt,
    });
    const workDeadlineAt = new Date(startedAt.getTime() + 20_000);
    const controller = new AbortController();
    const deadline: CollectionDeadline = {
      startedAt,
      workDeadlineAt,
      finalizationDeadlineAt: new Date(workDeadlineAt.getTime() + 30_000),
      signal: controller.signal,
      now: () => clock.value,
      remainingWorkMs: () =>
        workDeadlineAt.getTime() - clock.value.getTime(),
      remainingFinalizationMs: () =>
        workDeadlineAt.getTime() + 30_000 - clock.value.getTime(),
      dispose: () => undefined,
    };

    await expect(
      runAsyncInsightsReport(ports, {
        ...ARGS,
        deadline,
        pollIntervalMs: 5_000,
        pollTimeoutMs: 180_000,
      }),
    ).rejects.toMatchObject({ code: COLLECTION_DEADLINE_ERROR_CODE });

    expect(clock.value.getTime()).toBe(workDeadlineAt.getTime());
    expect(trace.filter((step) => step.startsWith("start:"))).toEqual([
      "start:report-1",
    ]);
    expect(trace.some((step) => step.startsWith("rows:"))).toBe(false);
  });

  test("erro de volume de linhas sobe intocado — quem fatia é o passo, não o job", async () => {
    const { ports, trace } = makePorts({ statuses: ["Job Completed"] });
    ports.startReport = async () => {
      trace.push("start:erro-de-volume");
      throw rowLimitError();
    };

    await expect(runAsyncInsightsReport(ports, ARGS)).rejects.toThrow(
      /reduce the amount of data/,
    );
    // Uma tentativa só: re-tentar o mesmo período grande demais é garantia de
    // erro, e a licença do app é throttled por taxa de erro.
    expect(trace.filter((step) => step === "start:erro-de-volume")).toHaveLength(1);
  });
});
