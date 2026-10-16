"use client";

import { useMemo } from "react";
import { Check, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Delta,
  GoalBadge,
  MetaHealthBadge,
  PlanBadge,
  SeverityDot,
  Sparkline,
} from "@/components/consultant-workspace/shared/primitives";
import { cn } from "@/lib/utils";
import {
  META_HEALTH_LABEL,
  PLAN_LABEL,
  delta,
  formatInt,
  formatMoney,
  formatRelative,
  formatRoas,
} from "@/lib/consultant-workspace/metrics";
import { STAGE_LABEL } from "@/lib/consultant-workspace/journey";
import type { WorkspaceGoal, WorkspaceRange } from "@/lib/consultant-workspace/types";
import { AssignConsultant } from "@/components/consultant-workspace/common/assignment";
import { downloadCsv } from "@/components/consultant-workspace/common/csv";
import {
  PacingBar,
  SortHeader,
  headClass,
  tableClass,
  type Density,
} from "@/components/consultant-workspace/common/grid";
import {
  NEXT_STEP_TONE,
  PlanText,
  StagePill,
  stageLine,
} from "@/components/consultant-workspace/common/journey-bits";
import { daysInStageText, rowReason, type CarteiraRow } from "@/components/consultant-workspace/common/model";
import { DEFAULT_DIR, type SortDir, type SortKey } from "./filters";
import { MoreSentinel } from "./fila";

export type ColKey =
  | "sinais"
  | "etapa"
  | "problemas"
  | "plano"
  | "responsavel"
  | "gasto"
  | "resultado"
  | "custo"
  | "meta"
  | "ritmo"
  | "gastoMes"
  | "roas"
  | "tendencia"
  | "conexao"
  | "alertas"
  | "toque";

export const COLUMNS: Array<{ key: ColKey; label: string; hint?: string; align: "left" | "right"; sortable: boolean }> = [
  { key: "sinais", label: "Sinais", hint: "O que está aberto e a posição na fila. Ordena por prioridade.", align: "left", sortable: true },
  { key: "etapa", label: "Etapa", hint: "Onde o cliente está na jornada e o que trava", align: "left", sortable: true },
  { key: "gasto", label: "Gasto", hint: "Gasto no período e variação contra o período anterior", align: "right", sortable: true },
  { key: "resultado", label: "Resultado", hint: "Compras, leads, conversas ou resultados — o que a conta otimiza", align: "right", sortable: true },
  { key: "custo", label: "Custo por resultado", align: "right", sortable: true },
  { key: "meta", label: "Meta", hint: "Clique para definir ou editar a meta combinada", align: "left", sortable: true },
  { key: "ritmo", label: "Verba do mês", hint: "Ritmo do gasto do mês contra a verba combinada", align: "left", sortable: true },
  { key: "problemas", label: "Problemas", hint: "Tags de problema (detectadas ou marcadas), cada uma com playbook", align: "left", sortable: true },
  { key: "responsavel", label: "Responsável", align: "left", sortable: true },
  { key: "tendencia", label: "Tendência", hint: "Gasto por dia no período", align: "left", sortable: true },
  { key: "conexao", label: "Conexão", align: "left", sortable: true },
  { key: "toque", label: "Último toque", hint: "Último contato, nota ou ação registrada por alguém da equipe", align: "left", sortable: true },
  { key: "plano", label: "Plano", hint: "Também aparece ao lado do nome", align: "left", sortable: true },
  { key: "gastoMes", label: "Gasto no mês", hint: "Do dia 1º até ontem", align: "right", sortable: true },
  { key: "roas", label: "ROAS", hint: "Valor de compras ÷ gasto (só contas de vendas)", align: "right", sortable: true },
  { key: "alertas", label: "Alertas", hint: "Alertas de campanha abertos (sem os tratados/adiados)", align: "right", sortable: true },
];

export const DEFAULT_HIDDEN: ColKey[] = ["plano", "gastoMes", "roas", "alertas"];

const SORT_FOR_COL: Record<ColKey, SortKey> = {
  sinais: "prioridade",
  etapa: "etapa",
  problemas: "problemas",
  plano: "plano",
  responsavel: "responsavel",
  gasto: "gasto",
  resultado: "resultado",
  custo: "custo",
  meta: "meta",
  ritmo: "ritmo",
  gastoMes: "gastoMes",
  roas: "roas",
  tendencia: "tendencia",
  conexao: "conexao",
  alertas: "alertas",
  toque: "toque",
};

function goalTargetText(goal: WorkspaceGoal) {
  return goal.kpi === "roas" ? `≥ ${formatRoas(goal.target)}` : `≤ ${formatMoney(goal.target)}`;
}

export function TabelaView({
  rows,
  limit,
  onMore,
  hiddenCols,
  density,
  sortKey,
  sortDir,
  onSort,
  focusId,
  checked,
  onToggleCheck,
  onToggleAll,
  onOpen,
  onGoal,
  now,
  hrefFor,
  sheet,
  emptyState,
}: {
  rows: CarteiraRow[];
  limit: number;
  onMore: () => void;
  hiddenCols: ColKey[];
  density: Density;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey, dir: SortDir) => void;
  focusId: string | null;
  checked: Set<string>;
  onToggleCheck: (row: CarteiraRow, shift: boolean) => void;
  onToggleAll: (value: boolean) => void;
  onOpen: (row: CarteiraRow) => void;
  onGoal: (row: CarteiraRow) => void;
  now: number;
  hrefFor: (userId: string) => string;
  sheet: React.ReactNode;
  emptyState: React.ReactNode;
}) {
  const visibleCols = COLUMNS.filter((column) => !hiddenCols.includes(column.key));
  const shown = rows.slice(0, limit);
  const checkedHere = rows.filter((row) => checked.has(row.userId)).length;
  const allChecked = rows.length > 0 && checkedHere === rows.length;

  const totals = useMemo(() => {
    const sum = { spend: 0, prevSpend: 0, mtd: 0, results: 0, prevResults: 0, salesSpend: 0, salesValue: 0, alerts: 0, withSignals: 0 };
    for (const row of rows) {
      const perf = row.client.perf;
      sum.spend += perf.current.spend;
      sum.prevSpend += perf.previous.spend;
      sum.mtd += perf.monthToDateSpend;
      sum.results += perf.kpi.count;
      sum.prevResults += perf.previousKpi.count;
      sum.alerts += row.alertCounts.open;
      if (row.trafficSignals.length) sum.withSignals += 1;
      if (perf.kpi.kind === "compras") {
        sum.salesSpend += perf.current.spend;
        sum.salesValue += perf.current.purchaseValue;
      }
    }
    return {
      ...sum,
      cost: sum.results > 0 ? sum.spend / sum.results : null,
      prevCost: sum.prevResults > 0 ? sum.prevSpend / sum.prevResults : null,
      roas: sum.salesSpend > 0 ? sum.salesValue / sum.salesSpend : null,
    };
  }, [rows]);

  function sortBy(key: SortKey) {
    onSort(key, key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key]);
  }

  function onRowClick(event: React.MouseEvent<HTMLTableRowElement>, row: CarteiraRow) {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button,input,select,[role=checkbox],[role=menuitem],[data-no-row-click]")) return;
    if (target.closest("a") && (event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    onOpen(row);
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">{emptyState}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" data-table-scroll>
          <table
            className={cn(
              tableClass(density),
              // Caixa de seleção leve por linha (a do design system pesa ~1 KB de classes × centenas de linhas).
              "[&_[data-row-check]]:flex [&_[data-row-check]]:size-4 [&_[data-row-check]]:shrink-0 [&_[data-row-check]]:items-center [&_[data-row-check]]:justify-center [&_[data-row-check]]:rounded-[4px] [&_[data-row-check]]:border [&_[data-row-check]]:border-input [&_[data-row-check]]:outline-none [&_[data-row-check]]:focus-visible:ring-2 [&_[data-row-check]]:focus-visible:ring-ring/50 [&_[data-row-check][aria-checked=true]]:border-primary [&_[data-row-check][aria-checked=true]]:bg-primary [&_[data-row-check][aria-checked=true]]:text-primary-foreground [&_[data-row-check]_svg]:size-3.5",
            )}
          >
            <thead>
              <tr>
                <th className={cn(headClass, "left-0 z-30 text-left")}>
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      checked={allChecked ? true : checkedHere > 0 ? "indeterminate" : false}
                      onCheckedChange={(value) => onToggleAll(value === true)}
                      aria-label="Selecionar todos"
                    />
                    <SortHeader
                      label={`Cliente · ${rows.length}`}
                      active={sortKey === "cliente"}
                      dir={sortDir}
                      onSort={() => sortBy("cliente")}
                    />
                  </div>
                </th>
                {visibleCols.map((column) => (
                  <th key={column.key} className={cn(headClass, column.align === "right" ? "text-right" : "text-left")}>
                    <SortHeader
                      label={column.label}
                      hint={column.hint}
                      align={column.align}
                      active={sortKey === SORT_FOR_COL[column.key]}
                      dir={sortDir}
                      onSort={column.sortable ? () => sortBy(SORT_FOR_COL[column.key]) : undefined}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const { client, journey } = row;
                const perf = client.perf;
                const focused = row.userId === focusId;
                const isChecked = checked.has(row.userId);
                const headline = row.headline;
                return (
                  <tr
                    key={row.userId}
                    id={`e-row-${row.userId}`}
                    aria-selected={focused}
                    className={cn(
                      "group cursor-pointer",
                      isChecked && "[&>td]:bg-sky-50 dark:[&>td]:bg-sky-950",
                      focused && "[&>td]:bg-muted",
                    )}
                    onClick={(event) => onRowClick(event, row)}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 bg-background",
                        focused && "shadow-[inset_3px_0_0_var(--color-sky-500)]",
                      )}
                    >
                      <div className="flex w-60 items-center gap-2.5 xl:w-64">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isChecked}
                          data-row-check
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleCheck(row, event.shiftKey);
                          }}
                          aria-label={`Selecionar ${row.title}`}
                        >
                          {isChecked ? <Check /> : null}
                        </button>
                        <div className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <a
                              href={hrefFor(client.userId)}
                              className="truncate font-medium hover:underline"
                              title={row.title}
                            >
                              {row.title}
                            </a>
                            {hiddenCols.includes("plano") ? <PlanText tier={client.plan.tier} className="ml-auto" /> : null}
                          </span>
                          {density === "confortavel" ? (
                            <span className="block truncate text-[11px] text-muted-foreground">{client.email}</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    {visibleCols.map((column) => {
                      switch (column.key) {
                        case "sinais": {
                          const reason = rowReason(row);
                          return (
                            <td key={column.key} title={row.reason ? `${row.rank ? `#${row.rank} na fila · ` : ""}${row.reason}` : undefined}>
                              {reason ? (
                                <div className={cn("flex max-w-64 items-center gap-1.5", row.bucket !== "fila" && "opacity-70")}>
                                  <span className={cn("truncate", NEXT_STEP_TONE[reason.tone])} title={reason.text}>
                                    {reason.text}
                                  </span>
                                  {headline && headline.others > 0 ? (
                                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">+{headline.others}</span>
                                  ) : null}
                                  {row.rank ? (
                                    <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground tabular-nums">#{row.rank}</span>
                                  ) : row.bucket === "automatico" ? (
                                    <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground">auto</span>
                                  ) : row.bucket === "outras_areas" ? (
                                    <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground">financeiro</span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                          );
                        }
                        case "etapa": {
                          // Rodando: o "o que fazer" já está em Sinais; aqui só há quanto tempo.
                          const etapaText =
                            journey.stage === "rodando" ? (daysInStageText(journey) ?? "") : stageLine(journey);
                          return (
                            <td key={column.key}>
                              <div className="flex max-w-56 items-center gap-1.5">
                                <StagePill stage={journey.stage} short />
                                <span className="truncate text-[11px] text-muted-foreground" title={etapaText}>
                                  {etapaText}
                                </span>
                              </div>
                            </td>
                          );
                        }
                        case "problemas":
                          return (
                            <td key={column.key}>
                              {journey.tags.length ? (
                                <div
                                  className="flex max-w-44 items-center gap-1 text-[11px] text-muted-foreground"
                                  title={journey.tags.map((tag) => tag.label).join("\n")}
                                >
                                  <span className="truncate">{journey.tags[0].label}</span>
                                  {journey.tags.length > 1 ? (
                                    <span className="shrink-0 text-[10px] tabular-nums">+{journey.tags.length - 1}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                          );
                        case "plano":
                          return (
                            <td key={column.key}>
                              <PlanBadge tier={client.plan.tier} />
                            </td>
                          );
                        case "responsavel":
                          return (
                            <td key={column.key}>
                              <AssignConsultant
                                variant="menu"
                                userId={client.userId}
                                clientName={row.title}
                                current={{ id: row.consultant, name: row.consultantName }}
                              />
                            </td>
                          );
                        case "gasto":
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              <div className="flex items-baseline justify-end gap-1.5">
                                <span className={cn(perf.current.spend === 0 && "text-muted-foreground")}>
                                  {formatMoney(perf.current.spend, false)}
                                </span>
                                <Delta value={row.spendDelta} neutral className="w-12 justify-end text-[11px]" />
                              </div>
                            </td>
                          );
                        case "resultado":
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              <div className="flex items-baseline justify-end gap-1.5">
                                <span className="text-[10px] text-muted-foreground">{perf.kpi.label.toLowerCase()}</span>
                                <span className={cn(perf.kpi.count === 0 && "text-muted-foreground")}>{formatInt(perf.kpi.count)}</span>
                                <Delta value={row.countDelta} className="w-12 justify-end text-[11px]" />
                              </div>
                            </td>
                          );
                        case "custo":
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              <div className="flex items-baseline justify-end gap-1.5">
                                <span className="text-[10px] text-muted-foreground">{perf.kpi.costLabel}</span>
                                <span
                                  className={cn(
                                    row.goalInfo.status === "fora" && "font-medium text-red-700 dark:text-red-400",
                                    row.goalInfo.status === "na_meta" && "text-emerald-700 dark:text-emerald-400",
                                  )}
                                >
                                  {formatMoney(perf.kpi.cost)}
                                </span>
                                <Delta value={row.costDelta} goodWhenUp={false} className="w-12 justify-end text-[11px]" />
                              </div>
                            </td>
                          );
                        case "meta":
                          return (
                            <td key={column.key}>
                              <button
                                type="button"
                                onClick={() => onGoal(row)}
                                className="-mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-background"
                                title={row.goal ? "Editar meta" : "Definir meta"}
                              >
                                {row.goal ? (
                                  <>
                                    <GoalBadge kpi={perf.kpi} goal={row.goal} />
                                    <span className="text-[11px] text-muted-foreground tabular-nums">{goalTargetText(row.goal)}</span>
                                  </>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 group-hover:text-primary">
                                    <Plus className="size-3" /> Definir
                                  </span>
                                )}
                              </button>
                            </td>
                          );
                        case "ritmo":
                          return (
                            <td key={column.key}>
                              <button
                                type="button"
                                onClick={() => onGoal(row)}
                                className="block w-28 text-left"
                                title={row.goal?.monthlyBudget ? undefined : "Definir verba mensal"}
                              >
                                {row.pacing && row.goal?.monthlyBudget ? (
                                  <PacingBar monthToDate={perf.monthToDateSpend} monthlyBudget={row.goal.monthlyBudget} pacing={row.pacing} />
                                ) : (
                                  <span className="text-[11px] text-muted-foreground/70 group-hover:text-muted-foreground">sem verba</span>
                                )}
                              </button>
                            </td>
                          );
                        case "gastoMes":
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              <span className={cn(perf.monthToDateSpend === 0 && "text-muted-foreground")}>
                                {formatMoney(perf.monthToDateSpend, false)}
                              </span>
                            </td>
                          );
                        case "roas":
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              {perf.kpi.roas != null ? formatRoas(perf.kpi.roas) : <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        case "tendencia":
                          return (
                            <td key={column.key}>
                              {perf.current.spend > 0 ? (
                                <Sparkline values={perf.series.map((point) => point.spend)} width={72} height={18} />
                              ) : (
                                <span className="text-[11px] text-muted-foreground">sem gasto</span>
                              )}
                            </td>
                          );
                        case "conexao":
                          return (
                            <td key={column.key}>
                              <MetaHealthBadge health={client.meta.health} detail={client.meta.detail} compact />
                            </td>
                          );
                        case "alertas": {
                          const worst =
                            row.alertCounts.critical > 0
                              ? "critical"
                              : row.alertCounts.warning > 0
                                ? "warning"
                                : row.alertCounts.open > 0
                                  ? "info"
                                  : null;
                          return (
                            <td key={column.key} className="text-right tabular-nums">
                              {worst ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <SeverityDot severity={worst} />
                                  {row.alertCounts.open}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                          );
                        }
                        case "toque":
                          return (
                            <td
                              key={column.key}
                              className={cn(
                                row.touchOverdue
                                  ? "font-medium text-red-700 dark:text-red-400"
                                  : !row.lastTouch && "text-muted-foreground",
                              )}
                              title={row.touchOverdue ? `${PLAN_LABEL[client.plan.tier]}: sem contato registrado há mais de 14 dias` : undefined}
                            >
                              {row.lastTouch ? formatRelative(row.lastTouch, now) : "nunca"}
                            </td>
                          );
                      }
                    })}
                  </tr>
                );
              })}
              {rows.length > shown.length ? (
                <MoreSentinel onMore={onMore} left={rows.length - shown.length} asRow colSpan={visibleCols.length + 1} />
              ) : null}
            </tbody>
            <tfoot>
              <tr className="text-xs font-medium">
                <td className="sticky bottom-0 left-0 z-20 border-t bg-muted px-3 py-2 whitespace-nowrap">
                  Total · {rows.length} {rows.length === 1 ? "cliente" : "clientes"}
                </td>
                {visibleCols.map((column) => {
                  const base = "sticky bottom-0 z-10 border-t bg-muted px-3 py-2 whitespace-nowrap tabular-nums";
                  switch (column.key) {
                    case "sinais":
                      return (
                        <td key={column.key} className={base}>
                          <span className="font-normal text-muted-foreground">{totals.withSignals} com sinal aberto</span>
                        </td>
                      );
                    case "gasto":
                      return (
                        <td key={column.key} className={cn(base, "text-right")}>
                          <div className="flex items-baseline justify-end gap-1.5">
                            {formatMoney(totals.spend, false)}
                            <Delta value={delta(totals.spend, totals.prevSpend)} neutral className="w-12 justify-end text-[11px]" />
                          </div>
                        </td>
                      );
                    case "gastoMes":
                      return (
                        <td key={column.key} className={cn(base, "text-right")}>
                          {formatMoney(totals.mtd, false)}
                        </td>
                      );
                    case "resultado":
                      return (
                        <td key={column.key} className={cn(base, "text-right")} title="Soma de compras, leads, conversas e resultados — cada conta no seu tipo">
                          <div className="flex items-baseline justify-end gap-1.5">
                            <span className="text-[10px] font-normal text-muted-foreground">soma</span>
                            {formatInt(totals.results)}
                            <Delta value={delta(totals.results, totals.prevResults)} className="w-12 justify-end text-[11px]" />
                          </div>
                        </td>
                      );
                    case "custo":
                      return (
                        <td key={column.key} className={cn(base, "text-right")} title="Gasto total ÷ resultados totais">
                          <div className="flex items-baseline justify-end gap-1.5">
                            <span className="text-[10px] font-normal text-muted-foreground">médio</span>
                            {formatMoney(totals.cost)}
                            <Delta value={delta(totals.cost, totals.prevCost)} goodWhenUp={false} className="w-12 justify-end text-[11px]" />
                          </div>
                        </td>
                      );
                    case "roas":
                      return (
                        <td key={column.key} className={cn(base, "text-right")} title="Só contas de vendas">
                          {formatRoas(totals.roas)}
                        </td>
                      );
                    case "alertas":
                      return (
                        <td key={column.key} className={cn(base, "text-right")}>
                          {totals.alerts || "—"}
                        </td>
                      );
                    default:
                      return <td key={column.key} className={base} />;
                  }
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {sheet}
    </div>
  );
}

export function exportCsv(rows: CarteiraRow[], range: WorkspaceRange, viewKey: string) {
  const days = range.days;
  const header = [
    "Cliente",
    "E-mail",
    "Plano",
    "Responsável",
    "Etapa",
    "Trava / situação",
    "Problemas",
    "Prioridade na fila",
    "Sinal principal",
    "Sinais abertos",
    `Gasto ${days}d`,
    `Gasto ${days}d anterior`,
    "Gasto no mês",
    "Verba mensal",
    "Ritmo da verba (%)",
    "Tipo de resultado",
    "Resultados",
    "Custo por resultado",
    "ROAS",
    "Meta",
    "Conexão Meta",
    "Último toque",
  ];
  const lines = rows.map((row) => {
    const { client } = row;
    return [
      row.title,
      client.email,
      PLAN_LABEL[client.plan.tier],
      row.consultantName ?? "",
      STAGE_LABEL[row.journey.stage],
      stageLine(row.journey),
      row.journey.tags.map((tag) => tag.label).join(", "),
      row.rank,
      row.headline?.title ?? "",
      row.signals.length,
      client.perf.current.spend,
      client.perf.previous.spend,
      client.perf.monthToDateSpend,
      row.goal?.monthlyBudget ?? null,
      row.pacing ? row.pacing.ratio * 100 : null,
      client.perf.kpi.label,
      client.perf.kpi.count,
      client.perf.kpi.cost,
      client.perf.kpi.roas,
      row.goal ? goalTargetText(row.goal) : "",
      META_HEALTH_LABEL[client.meta.health],
      row.lastTouch ? new Date(row.lastTouch).toISOString().slice(0, 10) : "nunca",
    ];
  });
  downloadCsv(`carteira-${viewKey}-${range.from}_${range.to}.csv`, header, lines);
}
