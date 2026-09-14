"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Minus, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StatusBadge,
  statusToneClassName,
  statusToneSurfaceClassName,
} from "@/components/ui/status-badge";
import {
  CRM_GOAL_STATUS_META,
  crmMonthOf,
  formatCrmMonth,
  SALES_ROLE_LABELS,
  shiftCrmMonth,
  type CrmMetric,
} from "@/lib/backoffice/crm-goals";
import { cn } from "@/lib/utils";
import {
  fetchCrmGoalLeads,
  fetchCrmGoals,
  formatDateTime,
  saveCrmGoals,
  type CrmGoalsResponse,
} from "./crm-api";
import { CommercialStatusBadge } from "./crm-badges";

/** Até onde o seletor deixa olhar para frente (metas de meses futuros). */
const MAX_MONTHS_AHEAD = 12;

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function CrmGoals({ onOpenLead }: { onOpenLead: (userId: string) => void }) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => crmMonthOf(new Date()));
  const [editing, setEditing] = useState(false);
  const [leadsFor, setLeadsFor] = useState<CrmMetric | null>(null);
  const queryKey = ["crm", "goals", month] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchCrmGoals(month),
    placeholderData: (previous) => previous,
  });

  const currentMonth = crmMonthOf(new Date());
  const canGoForward = month < shiftCrmMonth(currentMonth, MAX_MONTHS_AHEAD);
  const data = query.data;

  return (
    <section aria-label="Metas do comercial" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mês anterior"
            onClick={() => setMonth((current) => shiftCrmMonth(current, -1))}
          >
            <ChevronLeft />
          </Button>
          <h2 className="min-w-44 text-center text-sm font-semibold">
            Metas · {formatCrmMonth(month)}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo mês"
            disabled={!canGoForward}
            onClick={() => setMonth((current) => shiftCrmMonth(current, 1))}
          >
            <ChevronRight />
          </Button>
          {month !== currentMonth ? (
            <Button type="button" variant="link" size="sm" onClick={() => setMonth(currentMonth)}>
              Hoje
            </Button>
          ) : null}
        </div>
        {data?.canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Editar metas
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          Não deu para carregar as metas.{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => void query.refetch()}>
            Tentar de novo
          </button>
        </div>
      ) : !data ? (
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-3 md:grid-cols-3 transition-opacity",
            query.isPlaceholderData && "opacity-60",
          )}
        >
          {data.metrics.map((metric) => {
            const statusMeta = CRM_GOAL_STATUS_META[metric.status];
            return (
              <article
                key={metric.metric}
                aria-label={metric.label}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  statusToneSurfaceClassName(statusMeta.tone),
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{metric.label}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {SALES_ROLE_LABELS[metric.owner]}
                      {metric.ownerName ? ` · ${metric.ownerName}` : ""}
                    </p>
                  </div>
                  <StatusBadge tone={statusMeta.tone}>
                    {metric.target === null ? "Sem meta" : `Meta ${metric.target}%`}
                  </StatusBadge>
                </div>
                <p
                  className={cn(
                    "mt-3 text-3xl font-semibold tabular-nums",
                    metric.status !== "neutral" && statusToneClassName(statusMeta.tone),
                  )}
                  title={metric.description}
                >
                  {formatRate(metric.rate)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {metric.denominator === 0 && metric.numerator === 0 ? (
                    `Sem ${metric.denominatorLabel} no mês.`
                  ) : (
                    <button
                      type="button"
                      className="rounded-sm text-left underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => setLeadsFor(metric.metric)}
                    >
                      {metric.numerator} de {metric.denominator} {metric.denominatorLabel}{" "}
                      {metric.numeratorLabel}.
                    </button>
                  )}
                  {metric.pendingTrial ? ` ${metric.pendingTrial} ainda em trial.` : ""}
                </p>
                {metric.inherited && metric.target !== null && metric.sourceMonth ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Meta herdada de {formatCrmMonth(metric.sourceMonth).toLowerCase()}.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {data ? (
        <GoalLeadsDialog
          month={month}
          metric={leadsFor ? data.metrics.find((m) => m.metric === leadsFor) ?? null : null}
          onClose={() => setLeadsFor(null)}
          onOpenLead={(userId) => {
            setLeadsFor(null);
            onOpenLead(userId);
          }}
        />
      ) : null}

      {data ? (
        <EditGoalsDialog
          open={editing}
          onOpenChange={setEditing}
          month={month}
          data={data}
          onSaved={(next) => {
            queryClient.setQueryData(queryKey, next);
            void queryClient.invalidateQueries({ queryKey: ["crm", "goals"] });
          }}
        />
      ) : null}
    </section>
  );
}

function EditGoalsDialog({
  open,
  onOpenChange,
  month,
  data,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  data: CrmGoalsResponse;
  onSaved: (next: CrmGoalsResponse) => void;
}) {
  const [draft, setDraft] = useState<Record<CrmMetric, string>>(() => draftFrom(data));
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // Recarrega o rascunho toda vez que o diálogo abre para um mês.
  if (open && openedFor !== month) {
    setOpenedFor(month);
    setDraft(draftFrom(data));
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const save = useMutation({
    mutationFn: () =>
      saveCrmGoals(month, {
        agendamento: parseDraft(draft.agendamento),
        conversao_trial: parseDraft(draft.conversao_trial),
        conversao_real: parseDraft(draft.conversao_real),
      }),
    onSuccess: (next) => {
      onSaved(next);
      onOpenChange(false);
    },
  });

  const invalid = Object.values(draft).some((value) => parseDraft(value) === undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Metas de {formatCrmMonth(month).toLowerCase()}</DialogTitle>
          <DialogDescription>
            Percentual de 0 a 100. Vazio deixa a métrica sem meta. O que você salvar aqui vale
            deste mês em diante, até alguém mudar de novo.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          {data.metrics.map((metric) => (
            <div key={metric.metric} className="space-y-1.5">
              <Label htmlFor={`goal-${metric.metric}`}>
                {metric.label}{" "}
                <span className="font-normal text-muted-foreground">
                  · {SALES_ROLE_LABELS[metric.owner]}
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`goal-${metric.metric}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="Sem meta"
                  value={draft[metric.metric]}
                  aria-invalid={parseDraft(draft[metric.metric]) === undefined}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [metric.metric]: event.target.value }))
                  }
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {save.isError
              ? save.error.message
              : "Verde na meta, laranja até 10 pontos abaixo, vermelho além disso."}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={invalid || save.isPending}>
              Salvar metas
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Quem está por trás do "X de Y": cada lead, a data e se contou. */
function GoalLeadsDialog({
  month,
  metric,
  onClose,
  onOpenLead,
}: {
  month: string;
  metric: CrmGoalsResponse["metrics"][number] | null;
  onClose: () => void;
  onOpenLead: (userId: string) => void;
}) {
  const open = metric !== null;
  const query = useQuery({
    queryKey: ["crm", "goals", month, "leads", metric?.metric ?? ""] as const,
    queryFn: () => fetchCrmGoalLeads(month, metric!.metric),
    enabled: open,
  });
  const isScheduling = metric?.metric === "agendamento";
  const eventLabel = isScheduling ? "Agendou em" : "Reunião em";
  const countedLabel =
    metric?.metric === "conversao_real" ? "Cliente" : isScheduling ? "Agendou" : "Trial";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{metric?.label}</DialogTitle>
          <DialogDescription>
            {metric
              ? `${metric.numerator} de ${metric.denominator} ${metric.denominatorLabel} ${metric.numeratorLabel} em ${formatCrmMonth(month).toLowerCase()}. ${metric.description}`
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {query.isError ? (
            <p className="p-4 text-sm">
              Não deu para carregar os leads.{" "}
              <button type="button" className="font-medium underline" onClick={() => void query.refetch()}>
                Tentar de novo
              </button>
            </p>
          ) : !query.data ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : query.data.leads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum lead neste mês.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Status comercial</TableHead>
                  <TableHead>Cadastro</TableHead>
                  <TableHead>{eventLabel}</TableHead>
                  <TableHead className="text-right">{countedLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => onOpenLead(lead.id)}
                  >
                    <TableCell className="max-w-64">
                      <p className="truncate text-sm font-medium">
                        {lead.name?.trim() || lead.companyName || lead.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {lead.companyName && lead.name ? `${lead.companyName} · ` : ""}
                        {lead.email}
                      </p>
                    </TableCell>
                    <TableCell>
                      <CommercialStatusBadge status={lead.commercialStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {lead.createdAt ? formatDateTime(lead.createdAt) : "—"}
                      {isScheduling && !lead.inDenominator ? (
                        <span className="block text-[11px]">fora do mês</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {lead.eventAt ? formatDateTime(lead.eventAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {lead.inNumerator ? (
                        <Check className="ml-auto size-4 text-success" aria-label="Sim" />
                      ) : (
                        <Minus className="ml-auto size-4 text-muted-foreground/60" aria-label="Não" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function draftFrom(data: CrmGoalsResponse): Record<CrmMetric, string> {
  const draft = { agendamento: "", conversao_trial: "", conversao_real: "" };
  for (const metric of data.metrics) {
    draft[metric.metric] = metric.target === null ? "" : String(metric.target);
  }
  return draft;
}

/** "" = sem meta; inteiro 0–100 = meta; qualquer outra coisa é inválido. */
function parseDraft(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed <= 100 ? parsed : undefined;
}
