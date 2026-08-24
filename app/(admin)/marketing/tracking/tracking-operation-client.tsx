"use client";

import {
  AlertCircle,
  CalendarDays,
  CircleSlash,
  Loader2,
  PlugZap,
  Timer,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCalendarDateLabel,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import type {
  CoverageCellStatus,
  SerializedCoverageCell,
  SerializedCoverageGrid,
  SerializedTrackingRunView,
  TrackingRunOutcome,
} from "@/lib/meta-tracking/operation-view";
import { cn } from "@/lib/utils";

const RUN_OUTCOME_LABELS: Record<TrackingRunOutcome, string> = {
  running: "Em andamento",
  complete: "Completa",
  partial: "Parcial",
  failed: "Falhou",
};

const RUN_OUTCOME_VARIANTS: Record<
  TrackingRunOutcome,
  "default" | "secondary" | "destructive" | "outline"
> = {
  running: "outline",
  complete: "default",
  partial: "secondary",
  failed: "destructive",
};

const RUN_KIND_LABELS: Record<string, string> = {
  daily: "Coleta diária",
  backfill: "Backfill",
};

const TRIGGER_LABELS: Record<string, string> = {
  cron: "cron",
  script: "script",
  manual: "manual",
};

const CELL_LABELS: Record<CoverageCellStatus, string> = {
  complete: "Completa",
  partial: "Parcial",
  failed: "Falhou",
  skipped_reconnect: "Reconexão pendente",
  skipped_no_token: "Sem token",
  missing: "Sem coleta",
  untracked: "Fora do tracking",
};

/** Verde = dia fechado. Âmbar = incompleto. Vermelho = token quebrado. */
const CELL_CLASSES: Record<CoverageCellStatus, string> = {
  complete: "bg-emerald-500/80",
  partial: "bg-amber-500/80",
  failed: "bg-destructive/70",
  skipped_reconnect: "bg-destructive",
  skipped_no_token: "bg-destructive",
  missing: "bg-muted-foreground/25",
  untracked: "bg-muted/60 border border-dashed border-border",
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min ${String(seconds).padStart(2, "0")}s`;
}

function CounterPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">
        {value.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

function RunCard({ run }: { run: SerializedTrackingRunView }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {run.inProgress ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          <Badge variant={RUN_OUTCOME_VARIANTS[run.outcome]}>
            {RUN_OUTCOME_LABELS[run.outcome]}
          </Badge>
          <span className="text-sm font-medium">
            {RUN_KIND_LABELS[run.kind] ?? run.kind}
          </span>
          <span className="text-xs text-muted-foreground">
            via {TRIGGER_LABELS[run.triggeredBy] ?? run.triggeredBy}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatShortDateTimeInSaoPaulo(run.startedAt)}</span>
          <span className="flex items-center gap-1">
            <Timer className="size-3.5" />
            {formatDuration(run.durationMs)}
            {run.inProgress ? " (até agora)" : ""}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
        <CounterPill label="Contas" value={run.counters.accountsCovered} />
        <CounterPill label="Parciais" value={run.counters.accountsPartial} />
        <CounterPill label="Falhas" value={run.counters.accountsFailed} />
        <CounterPill label="Puladas" value={run.counters.accountsSkipped} />
        <CounterPill
          label="Reconexão"
          value={run.counters.accountsSkippedReconnect}
        />
        <CounterPill label="Versões" value={run.counters.versionsCreated} />
        <CounterPill label="Ações" value={run.counters.eventsCreated} />
        <CounterPill label="Métricas" value={run.counters.metricRowsUpserted} />
        <CounterPill label="Criativos" value={run.counters.creativesFetched} />
      </div>

      {run.counters.customerActionsRequired > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {run.counters.customerActionsRequired} cliente(s) precisam reconectar
          a Meta
          {run.counters.usersWithoutKnownAccounts > 0
            ? `; ${run.counters.usersWithoutKnownAccounts} ainda não têm conta conhecida para registrar cobertura`
            : ""}
          . Este é um bloqueio do cliente, não uma falha técnica da execução.
        </p>
      ) : null}

      {run.counters.eventsLinked > 0 ? (
        <p className="text-xs text-muted-foreground">
          {run.counters.eventsLinked} ação(ões) já registrada(s) pela plataforma
          foram reconhecidas em vez de duplicadas.
        </p>
      ) : null}

      {run.counters.creativesPending > 0 ? (
        <p className="text-xs text-muted-foreground">
          {run.counters.creativesPending} criativo(s) seguem sem snapshot — a
          próxima coleta tenta de novo.
        </p>
      ) : null}

      {run.errorMessage ? (
        <p className="text-xs text-destructive break-words">
          {run.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function CoverageCell({ cell }: { cell: SerializedCoverageCell }) {
  const detail = [
    `${formatCalendarDateLabel(cell.day)}: ${CELL_LABELS[cell.status]}`,
    cell.status === "complete" || cell.status === "partial"
      ? `${cell.entitiesSeen} entidades`
      : null,
    cell.errorMessage,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <span
      title={detail}
      aria-label={detail}
      className={cn("block h-5 w-5 rounded-sm", CELL_CLASSES[cell.status])}
    />
  );
}

function CoverageLegend() {
  const entries: CoverageCellStatus[] = [
    "complete",
    "partial",
    "failed",
    "skipped_reconnect",
    "missing",
    "untracked",
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {entries.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm", CELL_CLASSES[status])} />
          {CELL_LABELS[status]}
        </span>
      ))}
    </div>
  );
}

export function TrackingOperationClient({
  hasLoadError,
  today,
  runs,
  grid,
}: {
  hasLoadError: boolean;
  today: string;
  runs: SerializedTrackingRunView[];
  grid: SerializedCoverageGrid;
}) {
  const reconnectAccounts = grid.accounts.filter(
    (account) => account.needsReconnect,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Coleta Meta — operação
        </h1>
        <p className="text-sm text-muted-foreground">
          Execuções recentes e cobertura conta×dia do tracking de campanhas.
          Dia de referência: {formatCalendarDateLabel(today)}.
        </p>
      </div>

      {hasLoadError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Não foi possível carregar a coleta</AlertTitle>
          <AlertDescription>
            O detalhe do erro está no log do servidor. Se a fundação de tracking
            ainda não foi aplicada neste ambiente, esta tela fica vazia até a
            migration rodar.
          </AlertDescription>
        </Alert>
      ) : null}

      {reconnectAccounts.length > 0 ? (
        <Alert variant="destructive">
          <PlugZap className="size-4" />
          <AlertTitle>
            {reconnectAccounts.length} conta(s) com reconexão pendente
          </AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Sem token não há coleta, e a configuração desses dias não existe em
              lugar nenhum para ser buscada depois — o buraco na série é
              irrecuperável. Acione o cliente.
            </p>
            <ul className="space-y-1">
              {reconnectAccounts.map((account) => (
                <li key={account.accountId} className="text-xs">
                  <span className="font-medium">{account.accountId}</span>
                  {account.userEmail ? ` — ${account.userEmail}` : ""}
                  {account.lastCompleteDay
                    ? ` — última coleta completa em ${formatCalendarDateLabel(account.lastCompleteDay)}`
                    : " — nunca teve coleta completa"}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="size-4" />
            Execuções recentes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <CircleSlash className="size-8 mb-2 opacity-50" />
              <p className="text-sm">Nenhuma execução registrada ainda.</p>
              <p className="text-xs">
                O coletor roda de madrugada; também é possível disparar pelo
                script manual.
              </p>
            </div>
          ) : (
            runs.map((run) => <RunCard key={run.id} run={run} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4" />
            Cobertura por conta e dia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {grid.accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <CircleSlash className="size-8 mb-2 opacity-50" />
              <p className="text-sm">Nenhuma conta coletada no período.</p>
              <p className="text-xs">
                Contas aparecem aqui a partir da primeira coleta.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{grid.totals.accounts} conta(s)</span>
                <span>{grid.totals.daysComplete} dia(s) completo(s)</span>
                <span>
                  {grid.totals.accountsWithHoles} conta(s) com dia incompleto
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Conta</th>
                      {grid.days.map((day) => (
                        <th key={day} className="px-1 py-2 font-medium">
                          <span className="block w-5 text-center tabular-nums">
                            {day.slice(8)}
                          </span>
                        </th>
                      ))}
                      <th className="py-2 pl-4 font-medium">Buracos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.accounts.map((account) => (
                      <tr
                        key={account.accountId}
                        className={cn(
                          "border-t border-border/60",
                          account.needsReconnect && "bg-destructive/5",
                        )}
                      >
                        <td className="py-2 pr-4 align-middle">
                          <div className="min-w-0">
                            <p className="font-medium tabular-nums">
                              {account.accountId}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {account.userEmail ?? "—"}
                              {account.currency ? ` · ${account.currency}` : ""}
                              {account.timezoneName
                                ? ` · ${account.timezoneName}`
                                : ""}
                            </p>
                          </div>
                        </td>
                        {account.cells.map((cell) => (
                          <td key={cell.day} className="px-1 py-2 align-middle">
                            <CoverageCell cell={cell} />
                          </td>
                        ))}
                        <td className="py-2 pl-4 align-middle text-xs tabular-nums">
                          {account.daysIncomplete === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                account.needsReconnect
                                  ? "text-destructive font-medium"
                                  : "text-amber-600 dark:text-amber-500",
                              )}
                            >
                              {account.daysIncomplete}
                              {account.daysMissing > 0
                                ? ` (${account.daysMissing} sem coleta)`
                                : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CoverageLegend />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
