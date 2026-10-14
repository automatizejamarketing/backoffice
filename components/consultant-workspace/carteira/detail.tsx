"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Clock, NotebookPen, Target, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  GOAL_KPI_LABEL,
  PLAN_SERVICE,
  delta,
  formatInt,
  formatMoney,
  formatRelative,
  formatRoas,
} from "@/lib/consultant-workspace/metrics";
import type { NoteKind, WorkspaceNote, WorkspaceRange } from "@/lib/consultant-workspace/types";
import { AssignConsultant } from "@/components/consultant-workspace/common/assignment";
import { PacingBar } from "@/components/consultant-workspace/common/grid";
import { JourneyStepper, StagePill } from "@/components/consultant-workspace/common/journey-bits";
import type { CarteiraRow } from "@/components/consultant-workspace/common/model";
import { plural } from "@/components/consultant-workspace/common/signal-helpers";
import { SuggestedActionsCompact } from "@/components/consultant-workspace/shared/suggested-actions";
import { ProblemTagsInline } from "./problem-tags";
import { SignalList } from "./signal-list";

const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  nota: "Nota",
  contato: "Contato",
  reuniao: "Reunião",
  acao: "Ação",
};

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("ml-1 rounded border border-current/20 px-1 font-mono text-[10px] opacity-70", className)}>
      {children}
    </kbd>
  );
}

/**
 * O painel do cliente: sinais, jornada, meta/ritmo e últimas notas.
 * Igual na Fila (à direita) e na Mesa (painel lateral).
 */
export function ClientDetail({
  row,
  notes,
  range,
  now,
  href,
  openKey,
  onResolve,
  onSnooze,
  onNote,
  onGoal,
}: {
  row: CarteiraRow;
  notes: WorkspaceNote[];
  range: WorkspaceRange;
  now: number;
  href: string;
  /** Tecla que abre a página do cliente nesta visão. */
  openKey: string;
  onResolve: () => void;
  onSnooze: () => void;
  onNote: () => void;
  onGoal: () => void;
}) {
  const { client, goal, journey } = row;
  const perf = client.perf;
  const hasSignals = row.actionIds.length > 0;

  return (
    <article className="@container space-y-5 px-5 py-4">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <h2 className="text-lg font-semibold tracking-tight">{row.title}</h2>
          <PlanBadge tier={client.plan.tier} />
          <StagePill stage={journey.stage} />
          <MetaHealthBadge health={client.meta.health} detail={client.meta.detail} />
        </div>
        <p className="text-xs text-muted-foreground">
          {PLAN_SERVICE[client.plan.tier]}
          {client.companyName && client.name ? ` · ${client.name}` : ""}
          {client.email !== row.title ? ` · ${client.email}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.reason ? (
            <>
              <span>Prioridade:</span>
              <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                {row.rank ? `#${row.rank} · ` : ""}
                {row.reason}
              </span>
            </>
          ) : null}
          <span className={row.reason ? "ml-2" : undefined}>Responsável:</span>
          <AssignConsultant
            userId={client.userId}
            clientName={row.title}
            current={{ id: row.consultant, name: row.consultantName }}
            className="h-6 w-36 text-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button size="sm" onClick={onResolve} disabled={!hasSignals}>
            <Check className="size-3.5" /> Concluir <Kbd>e</Kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={onSnooze} disabled={!hasSignals}>
            <Clock className="size-3.5" /> Adiar <Kbd>s</Kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={onNote}>
            <NotebookPen className="size-3.5" /> Nota <Kbd>n</Kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={onGoal}>
            <Target className="size-3.5" /> Meta <Kbd>m</Kbd>
          </Button>
          <Button size="sm" variant="ghost" asChild className="ml-auto">
            <Link href={href}>
              Abrir cliente <Kbd>{openKey}</Kbd>
            </Link>
          </Button>
        </div>
      </header>

      <section className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Por que está aqui</h3>
        {row.trafficSignals.length > 0 ? (
          <SignalList signals={row.trafficSignals} now={now} onFix={(fix) => (fix === "meta" ? onGoal() : onNote())} />
        ) : row.otherAreaSignals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Nada aberto agora. Tratado, adiado ou rodando sem exceção.
          </p>
        ) : null}
        {row.otherAreaSignals.length > 0 ? (
          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> Aberto em Financeiro/CS — só para você saber antes de falar com o cliente
            </p>
            <ul className="space-y-1 text-sm">
              {row.otherAreaSignals.map((signal) => (
                <li key={signal.key} className="flex items-start gap-2">
                  <span className="pt-1.5">
                    <SeverityDot severity={signal.severity} />
                  </span>
                  <span>
                    {signal.title} <span className="text-xs text-muted-foreground">— {signal.evidence}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {row.bucket === "automatico" ? (
          <p className="text-[11px] text-muted-foreground">
            Pelo plano {client.plan.tier === "pro" ? "Pro" : "Starter"}, isto segue no automático — não entra na sua fila.
          </p>
        ) : null}
      </section>

      <SuggestedActionsCompact
        userId={client.userId}
        clientName={row.title}
        clientFullName={client.name}
        days={range.days}
      />

      <section className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Jornada</h3>
        <JourneyStepper journey={journey} compact />
        {journey.handoff ? (
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
            <span className="font-medium">Passagem do Fred:</span> {journey.handoff.summary}
            {journey.handoff.nextSteps ? <span className="text-muted-foreground"> — {journey.handoff.nextSteps}</span> : null}
          </p>
        ) : null}
        <ProblemTagsInline client={client} journey={journey} dense />
      </section>

      <section className="grid gap-3 @xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Desempenho · {range.days} dias
            </h3>
            <span className="text-[11px] text-muted-foreground">vs. {range.days} dias antes</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Gasto" value={formatMoney(perf.current.spend, false)}>
              <Delta value={row.spendDelta} neutral />
            </Metric>
            <Metric label={perf.kpi.label} value={formatInt(perf.kpi.count)}>
              <Delta value={row.countDelta} />
            </Metric>
            <Metric label={perf.kpi.costLabel} value={formatMoney(perf.kpi.cost)}>
              <Delta value={delta(perf.kpi.cost, perf.previousKpi.cost)} goodWhenUp={false} />
            </Metric>
          </div>
          <div className="flex items-end justify-between gap-3">
            <Sparkline values={perf.series.map((point) => point.spend)} width={200} height={32} />
            <div className="text-right text-[11px] text-muted-foreground">
              {perf.kpi.roas != null ? <p>ROAS {formatRoas(perf.kpi.roas)}</p> : null}
              <p>{plural(perf.activeCampaigns, "campanha gastando", "campanhas gastando")}</p>
              <p>Mês: {formatMoney(perf.monthToDateSpend, false)}</p>
            </div>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Meta do cliente</h3>
            <GoalBadge kpi={perf.kpi} goal={goal} />
          </div>
          {goal ? (
            <div className="space-y-2 text-sm">
              <p>
                {GOAL_KPI_LABEL[goal.kpi]}:{" "}
                <span className="font-medium">{goal.kpi === "roas" ? formatRoas(goal.target) : formatMoney(goal.target)}</span>
                {row.goalInfo.actual != null ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · agora {goal.kpi === "roas" ? formatRoas(row.goalInfo.actual) : formatMoney(row.goalInfo.actual)}
                  </span>
                ) : null}
              </p>
              {goal.monthlyBudget && row.pacing ? (
                <PacingBar monthToDate={perf.monthToDateSpend} monthlyBudget={goal.monthlyBudget} pacing={row.pacing} />
              ) : (
                <p className="text-xs text-muted-foreground">Sem verba mensal combinada.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem meta combinada — sem ela não dá para dizer se está bom ou ruim.</p>
          )}
          <Button size="sm" variant="outline" onClick={onGoal}>
            <Target className="size-3.5" /> {goal ? "Editar meta" : "Definir meta"} <Kbd>m</Kbd>
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Últimas notas</h3>
          <Link href={href} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
            Histórico completo <ArrowUpRight className="size-3" />
          </Link>
        </div>
        {notes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Ninguém registrou nada sobre este cliente ainda. Aperte <Kbd>n</Kbd> para deixar uma nota.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg border px-3 py-2">
                <p className="text-sm">{note.text}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {NOTE_KIND_LABEL[note.kind]} · {formatRelative(note.createdAt, now)} · {note.author}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Último toque da equipe: {row.lastTouch ? formatRelative(row.lastTouch, now) : "nunca"}
        </p>
      </section>
    </article>
  );
}

function Metric({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold leading-tight tabular-nums">{value}</p>
      {children}
    </div>
  );
}
