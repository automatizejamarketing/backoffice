"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  PayerRetentionCohort,
  PayerRetentionSummary,
} from "@/lib/backoffice/payer-retention";
import { cn } from "@/lib/utils";
import { PayerRetentionCohortUsersDialog } from "./payer-retention-cohort-users-dialog";

const numberFormatter = new Intl.NumberFormat("pt-BR");
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatPercentage(value: number) {
  return `${percentageFormatter.format(value)}%`;
}

function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatWeek(weekStart: string) {
  const start = calendarDate(weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startMonth = start.toLocaleDateString("pt-BR", {
    month: "short",
    timeZone: "UTC",
  });
  const endMonth = end.toLocaleDateString("pt-BR", {
    month: "short",
    timeZone: "UTC",
  });
  const year = end.getUTCFullYear();

  if (startMonth === endMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${endMonth} ${year}`;
  }
  return `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth} ${year}`;
}

function formatWeekColumn(weekStart: string) {
  return calendarDate(weekStart)
    .toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    })
    .replace(".", "");
}

function retentionCellColor(retentionRate: number) {
  const strength = Math.round(10 + retentionRate * 0.62);
  return {
    backgroundColor: `color-mix(in oklab, var(--chart-1) ${strength}%, var(--card))`,
  };
}

function CohortSummary({
  cohort,
  summary,
}: {
  cohort: PayerRetentionCohort | null;
  summary: PayerRetentionSummary;
}) {
  const headline = cohort ?? {
    initialPayers: summary.totalPayers,
    activeToday: summary.activeToday,
    retentionRate: summary.retentionRate,
  };

  return (
    <dl className="grid overflow-hidden rounded-xl border bg-card shadow-xs sm:grid-cols-3 sm:divide-x">
      <div className="border-b p-5 sm:border-b-0">
        <dt className="text-xs text-muted-foreground">Viraram pagantes</dt>
        <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {formatNumber(headline.initialPayers)}
        </dd>
      </div>
      <div className="border-b p-5 sm:border-b-0">
        <dt className="text-xs text-muted-foreground">Ativos hoje</dt>
        <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {formatNumber(headline.activeToday)}
        </dd>
      </div>
      <div className="p-5">
        <dt className="text-xs text-muted-foreground">Retenção até hoje</dt>
        <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {formatPercentage(headline.retentionRate)}
        </dd>
      </div>
    </dl>
  );
}

export function PayerRetentionChart({
  summary,
}: {
  summary: PayerRetentionSummary;
}) {
  const [selectedWeek, setSelectedWeek] = useState("all");
  const [usersWeek, setUsersWeek] = useState<string | null>(null);
  const matrixViewportRef = useRef<HTMLDivElement>(null);
  const matrixCohorts = useMemo(
    () => [...summary.cohorts].reverse(),
    [summary.cohorts],
  );
  const selectedCohort = useMemo(
    () =>
      selectedWeek === "all"
        ? null
        : (summary.cohorts.find(
            (cohort) => cohort.weekStart === selectedWeek,
          ) ?? null),
    [selectedWeek, summary.cohorts],
  );
  const usersCohort = useMemo(
    () =>
      usersWeek === null
        ? null
        : (summary.cohorts.find((cohort) => cohort.weekStart === usersWeek) ??
          null),
    [usersWeek, summary.cohorts],
  );

  function openCohortUsers(weekStart: string) {
    setSelectedWeek(weekStart);
    setUsersWeek(weekStart);
  }
  const maxAgeWeeks = Math.max(
    0,
    ...summary.cohorts.flatMap((cohort) =>
      cohort.retention.map((cell) => cell.ageWeeks),
    ),
  );
  const ages = Array.from({ length: maxAgeWeeks + 1 }, (_, index) => index);

  useEffect(() => {
    const viewport = matrixViewportRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollWidth;
  }, []);

  useEffect(() => {
    if (selectedWeek === "all") return;
    const column = document.querySelector<HTMLElement>(
      `[data-cohort-week="${selectedWeek}"]`,
    );
    column?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedWeek]);

  if (summary.cohorts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-12 text-center">
        <p className="text-sm font-medium">Nenhuma coorte pagante encontrada</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A primeira coorte aparecerá após um pagamento aprovado.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {selectedCohort
                ? `Coorte de ${formatWeek(selectedCohort.weekStart)}`
                : "Todas as coortes"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              A matriz acompanha quantos clientes mantiveram acesso pago ao fim
              de cada semana desde o primeiro pagamento, nas últimas 12
              semanas.
            </p>
          </div>
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger className="h-9 w-full text-xs shadow-none sm:w-[260px]">
              <SelectValue placeholder="Selecionar coorte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Últimas 12 semanas</SelectItem>
              {summary.cohorts.map((cohort) => (
                <SelectItem key={cohort.weekStart} value={cohort.weekStart}>
                  {formatWeek(cohort.weekStart)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CohortSummary cohort={selectedCohort} summary={summary} />

        <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h3 className="text-sm font-semibold">Matriz de retenção</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                S0 é a semana em que a coorte virou pagante. Clique em uma
                coluna para ver quem entrou naquela semana.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Menor</span>
              {[20, 40, 60, 80, 100].map((rate) => (
                <span
                  key={rate}
                  aria-hidden="true"
                  className="h-4 w-7 rounded-[3px] border border-foreground/5"
                  style={retentionCellColor(rate)}
                />
              ))}
              <span>Maior</span>
            </div>
          </div>

          <div
            ref={matrixViewportRef}
            className="max-h-[620px] overflow-auto overscroll-contain"
          >
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-30 min-w-20 border-b border-r bg-muted px-3 py-3 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Tempo
                  </th>
                  {matrixCohorts.map((cohort) => {
                    const selected = cohort.weekStart === selectedWeek;
                    return (
                      <th
                        key={cohort.weekStart}
                        scope="col"
                        data-cohort-week={cohort.weekStart}
                        className={cn(
                          "min-w-[82px] border-b border-r bg-muted/95 p-0 text-center last:border-r-0",
                          selected && "bg-chart-1/20",
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`Ver usuários da coorte de ${formatWeek(cohort.weekStart)}`}
                          onClick={() => openCohortUsers(cohort.weekStart)}
                          className="w-full px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          {formatWeekColumn(cohort.weekStart)}
                          <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-normal">
                            {formatNumber(cohort.initialPayers)} pagantes
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ages.map((ageWeeks) => (
                  <tr key={ageWeeks}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r bg-card px-3 py-3 text-left font-semibold tabular-nums last:border-b-0"
                    >
                      S{ageWeeks}
                    </th>
                    {matrixCohorts.map((cohort) => {
                      const cell = cohort.retention.find(
                        (item) => item.ageWeeks === ageWeeks,
                      );
                      const selected = cohort.weekStart === selectedWeek;

                      if (!cell) {
                        return (
                          <td
                            key={cohort.weekStart}
                            className={cn(
                              "border-b border-r bg-muted/10 p-1 text-center text-muted-foreground/40 last:border-r-0",
                              selected && "bg-chart-1/5",
                            )}
                          >
                            —
                          </td>
                        );
                      }

                      return (
                        <td
                          key={cohort.weekStart}
                          className={cn(
                            "border-b border-r p-1 last:border-r-0",
                            selected && "bg-chart-1/10",
                          )}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => openCohortUsers(cohort.weekStart)}
                                aria-label={`${formatPercentage(cell.retentionRate)} na semana ${ageWeeks}: ${formatNumber(cell.retainedPayers)} de ${formatNumber(cell.initialPayers)} pagantes. Ver usuários da coorte.`}
                                className={cn(
                                  "flex h-10 w-full min-w-[72px] items-center justify-center rounded-[4px] border border-foreground/5 px-2 font-semibold tabular-nums outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                  selected && "ring-1 ring-chart-1/60",
                                )}
                                style={retentionCellColor(cell.retentionRate)}
                              >
                                {formatPercentage(cell.retentionRate)}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="space-y-0.5 text-xs">
                              <p className="font-medium">
                                {formatNumber(cell.retainedPayers)} de{" "}
                                {formatNumber(cell.initialPayers)} pagantes
                              </p>
                              <p className="text-muted-foreground">
                                S{ageWeeks} · coorte de{" "}
                                {formatWeek(cohort.weekStart)}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A matriz usa apenas semanas encerradas e o histórico de início e fim
          das assinaturas. “Ativo hoje” considera o acesso vigente agora;
          cancelamentos agendados continuam ativos até o vencimento.
        </p>

        <PayerRetentionCohortUsersDialog
          weekStart={usersWeek}
          title={
            usersCohort ? `Coorte de ${formatWeek(usersCohort.weekStart)}` : ""
          }
          initialPayers={usersCohort?.initialPayers ?? 0}
          activeToday={usersCohort?.activeToday ?? 0}
          onOpenChange={(open) => {
            if (!open) setUsersWeek(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
