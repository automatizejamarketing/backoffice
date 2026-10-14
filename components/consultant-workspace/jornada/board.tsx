"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Handshake,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PROBLEM_TAGS,
  PROBLEM_TAG_BY_KEY,
  STAGE_DESCRIPTION,
  STAGE_LABEL,
  type JourneyExtras,
  type JourneyStage,
  type JourneyStepKey,
} from "@/lib/consultant-workspace/journey";
import { PLAN_RANK, delta, formatMoney } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient, WorkspaceRange, WorkspaceState } from "@/lib/consultant-workspace/types";
import { Delta, PlanBadge } from "@/components/consultant-workspace/shared/primitives";
import { useAssignmentOverrides } from "@/components/consultant-workspace/common/assignment";
import { useConsultantScope } from "@/components/consultant-workspace/common/consultant-scope";
import { FinanceChip, ProblemTagChip, StageDot } from "@/components/consultant-workspace/common/journey-bits";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import {
  buildRows,
  daysInStageText,
  handledTodayCount,
  planGroupOf,
  type PlanGroup,
} from "@/components/consultant-workspace/common/model";
import { clientHref } from "@/components/consultant-workspace/common/routes";
import { SummaryStrip, computeStripCounts } from "@/components/consultant-workspace/common/summary-strip";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useWorkspaceMe } from "@/components/consultant-workspace/common/workspace-context";
import { replaceParams } from "@/components/consultant-workspace/carteira/filters";
import { TemplateComposerDialog, type ComposerTarget } from "@/components/consultant-workspace/cliente/composer";
import {
  attentionLine,
  consultantOf,
  fillAlert,
  formatPhone,
  plural,
  primaryTemplateKey,
  type SlimAlert,
} from "./lib";
import type { StoppedSpend } from "./server-data";
import { useJourneyRows, type JourneyRow } from "./use-journeys";

const BLOCKER_ORDER: JourneyStepKey[] = ["acesso", "meta", "certificacao", "campanha", "veiculando"];
const BLOCKER_LABEL: Record<JourneyStepKey, string> = {
  acesso: "Acesso ativo",
  fred: "Onboarding com o Fred",
  meta: "Facebook conectado",
  certificacao: "Conta liberada pela Meta",
  campanha: "1ª campanha publicada",
  veiculando: "Veiculando",
};

const PLAN_GROUPS: PlanGroup[] = ["premium", "pro", "starter"];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesSearch(client: WorkspaceClient, query: string) {
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  const haystack = normalize([client.displayName, client.name ?? "", client.email].join(" "));
  if (haystack.includes(normalize(query))) return true;
  return digits.length >= 4 && (client.phone ?? "").replace(/\D/g, "").includes(digits);
}

/**
 * Jornada: cada cliente na etapa em que está (onboarding, rodando, parado),
 * com o que fazer agora e a mensagem para mandar. O resumo por plano no topo
 * é o mesmo da Fila e da Mesa.
 */
export function JourneyBoard({
  range,
  clients,
  alerts,
  extras,
  stopped,
  touchedAlertUser,
  initialStore,
  now,
}: {
  range: WorkspaceRange;
  clients: WorkspaceClient[];
  alerts: SlimAlert[];
  extras: Record<string, JourneyExtras>;
  stopped: Record<string, StoppedSpend>;
  touchedAlertUser: Record<string, string>;
  initialStore: WorkspaceState;
  now: number;
}) {
  const me = useWorkspaceMe();
  const { store } = usePrimedWorkspaceState(initialStore, now);
  const scope = useConsultantScope();
  const assignments = useAssignmentOverrides();
  const params = useSearchParams();
  const rawTag = params.get("tag");
  const tagFilter = rawTag && PROBLEM_TAG_BY_KEY.has(rawTag) ? rawTag : null;
  const rawPlan = params.get("plano") as PlanGroup | null;
  const plan = rawPlan && PLAN_GROUPS.includes(rawPlan) ? rawPlan : null;
  const [search, setSearch] = useState("");
  const [onlyNoHandoff, setOnlyNoHandoff] = useState(false);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  useRememberView(params.toString());

  const rows = useJourneyRows(clients, alerts, extras, store, now);
  const matchesScope = scope.matches;

  // Mesmo modelo da Fila/Mesa, só para o resumo por plano.
  const fullAlerts = useMemo(() => alerts.map(fillAlert), [alerts]);
  const carteiraRows = useMemo(
    () => buildRows({ clients, alerts: fullAlerts, extras, store, range, now, assignments }),
    [clients, fullAlerts, extras, store, range, now, assignments],
  );
  const alertUser = useMemo(() => {
    const map = new Map<string, string>(Object.entries(touchedAlertUser));
    for (const alert of alerts) map.set(alert.id, alert.userId);
    return map;
  }, [alerts, touchedAlertUser]);
  const handled = useMemo(() => handledTodayCount(store, alertUser, now, me.email), [store, alertUser, now, me.email]);

  const inScope = useMemo(
    () =>
      rows.filter(
        ({ client }) => matchesScope(consultantOf(client, assignments)) && matchesSearch(client, search.trim()),
      ),
    [rows, matchesScope, assignments, search],
  );
  const scoped = useMemo(
    () => inScope.filter(({ client }) => !plan || planGroupOf(client.plan.tier) === plan),
    [inScope, plan],
  );

  const strip = useMemo(() => {
    const ids = new Set(
      inScope
        .filter(({ journey }) => !tagFilter || journey.tags.some((tag) => tag.key === tagFilter))
        .map(({ client }) => client.userId),
    );
    return computeStripCounts(carteiraRows.filter((row) => ids.has(row.userId)));
  }, [inScope, carteiraRows, tagFilter]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { journey } of scoped) {
      for (const tag of journey.tags) counts.set(tag.key, (counts.get(tag.key) ?? 0) + 1);
    }
    return counts;
  }, [scoped]);

  const visible = scoped.filter(
    ({ journey }) =>
      (!tagFilter || journey.tags.some((tag) => tag.key === tagFilter)) &&
      (!onlyNoHandoff || (journey.stage === "onboarding" && !journey.handoff)),
  );
  const byStage = (stage: JourneyStage) => visible.filter((row) => row.journey.stage === stage);
  const onboarding = byStage("onboarding");
  const rodando = byStage("rodando");
  const parado = byStage("parado");
  const noHandoff = scoped.filter((row) => row.journey.stage === "onboarding" && !row.journey.handoff).length;

  function setParam(key: string, value: string | null) {
    replaceParams((query) => {
      if (value) query.set(key, value);
      else query.delete(key);
    });
  }

  const openMessage = (row: JourneyRow) =>
    setComposer({ client: row.client, journey: row.journey, templateKey: primaryTemplateKey(row.journey, row.client) });

  const filtersActive = Boolean(tagFilter || onlyNoHandoff || search.trim() || plan);
  const tagChips = PROBLEM_TAGS.filter((tag) => (tagCounts.get(tag.key) ?? 0) > 0 || tag.key === tagFilter).sort(
    (a, b) => (tagCounts.get(b.key) ?? 0) - (tagCounts.get(a.key) ?? 0),
  );

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-3 px-4 pt-3 pb-3 lg:px-6">
        <SummaryStrip
          counts={strip.counts}
          plan={plan}
          onPlan={(next) => setParam("plano", next)}
          handled={handled}
          remaining={strip.remaining}
        />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Jornada dos clientes</h1>
            <p className="text-xs text-muted-foreground">
              {plural(scoped.length, "cliente ativo", "clientes ativos")}
              {scope.filtered ? ` · carteira: ${scope.label}` : ""}
              {plan ? ` · plano ${plan === "premium" ? "Premium" : plan === "pro" ? "Pro" : "Starter"}` : ""} · em que
              etapa cada um está e o que fazer agora · gasto até ontem ({range.days} dias)
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente, e-mail ou telefone"
              className="h-8 pl-8 text-sm"
              aria-label="Buscar cliente"
            />
          </div>
        </div>

        {noHandoff > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
            <Handshake className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span>
              <strong className="font-semibold tabular-nums">{noHandoff}</strong>{" "}
              {noHandoff === 1 ? "cliente em onboarding sem passagem de bastão" : "clientes em onboarding sem passagem de bastão"}{" "}
              <span className="text-sky-800/80 dark:text-sky-200/70">— peça ao Fred o resumo da call antes de falar com eles.</span>
            </span>
            <Button
              size="xs"
              variant={onlyNoHandoff ? "default" : "outline"}
              className="ml-auto"
              onClick={() => setOnlyNoHandoff((value) => !value)}
            >
              {onlyNoHandoff ? "Mostrar todos" : "Mostrar só esses"}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Problemas:</span>
          {tagChips.length === 0 ? (
            <span className="text-xs text-muted-foreground">nenhuma tag nos clientes filtrados</span>
          ) : (
            tagChips.map((tag) => {
              const active = tagFilter === tag.key;
              return (
                <button
                  key={tag.key}
                  type="button"
                  onClick={() => setParam("tag", active ? null : tag.key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:border-primary/50",
                  )}
                >
                  {tag.auto ? <Sparkles className={cn("size-3", active ? "opacity-90" : "text-amber-600 dark:text-amber-400")} /> : null}
                  {tag.label}
                  <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
                    {tagCounts.get(tag.key) ?? 0}
                  </span>
                </button>
              );
            })
          )}
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                replaceParams((query) => {
                  query.delete("tag");
                  query.delete("plano");
                });
                setOnlyNoHandoff(false);
                setSearch("");
              }}
              className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 px-4 pb-4 lg:px-6 @3xl:min-h-[420px] @3xl:flex-1 @3xl:grid-cols-3">
        <StageColumn stage="onboarding" count={onboarding.length}>
          <OnboardingColumn rows={onboarding} onMessage={openMessage} />
        </StageColumn>
        <StageColumn stage="rodando" count={rodando.length}>
          <RodandoColumn rows={rodando} range={range} onMessage={openMessage} forceOpen={filtersActive} />
        </StageColumn>
        <StageColumn stage="parado" count={parado.length}>
          <ParadoColumn rows={parado} stopped={stopped} onMessage={openMessage} />
        </StageColumn>
      </div>

      <TemplateComposerDialog target={composer} onClose={() => setComposer(null)} />
    </div>
  );
}

function StageColumn({
  stage,
  count,
  children,
}: {
  stage: JourneyStage;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-muted/30 @3xl:min-h-0" aria-label={STAGE_LABEL[stage]}>
      <header className="border-b px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StageDot stage={stage} />
          {STAGE_LABEL[stage]}
          <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{STAGE_DESCRIPTION[stage]}</p>
      </header>
      <div className="space-y-3 p-2 @3xl:min-h-0 @3xl:flex-1 @3xl:overflow-y-auto">{children}</div>
    </section>
  );
}

function EmptyColumn() {
  return (
    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
      Ninguém nesta etapa com esses filtros.
    </p>
  );
}

function GroupHeader({
  open,
  onToggle,
  title,
  count,
  hint,
  tone = "default",
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  count: number;
  hint?: string;
  tone?: "default" | "attention" | "calm";
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-start gap-1.5 rounded-md px-1 py-1 text-left hover:bg-muted/60"
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-xs font-semibold",
            tone === "attention" && "text-red-700 dark:text-red-400",
            tone === "calm" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {title} <span className="font-normal tabular-nums text-muted-foreground">({count})</span>
        </span>
        {hint ? <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                           */
/* ------------------------------------------------------------------ */

function OnboardingColumn({ rows, onMessage }: { rows: JourneyRow[]; onMessage: (row: JourneyRow) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  if (rows.length === 0) return <EmptyColumn />;
  const groups = BLOCKER_ORDER.map((key) => ({
    key,
    rows: rows
      .filter((row) => (row.journey.blocker?.key ?? "veiculando") === key)
      .sort((a, b) => (b.journey.daysInStage ?? -1) - (a.journey.daysInStage ?? -1)),
  })).filter((group) => group.rows.length > 0);

  return (
    <>
      {groups.map((group) => {
        const open = !closed.has(group.key);
        const stale = group.rows.filter((row) => (row.journey.daysInStage ?? 0) > 7).length;
        return (
          <div key={group.key} className="space-y-1.5">
            <GroupHeader
              open={open}
              onToggle={() =>
                setClosed((current) => {
                  const next = new Set(current);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              title={<>Travado em: {BLOCKER_LABEL[group.key]}</>}
              count={group.rows.length}
              hint={stale > 0 ? `${stale} há mais de 7 dias` : undefined}
            />
            {open ? (
              <ul className="space-y-1.5">
                {group.rows.map((row) => (
                  <ClientCard key={row.client.userId} row={row} onMessage={onMessage}>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      <DaysText row={row} />
                      {!row.journey.handoff ? (
                        <span className="inline-flex items-center gap-1 rounded border border-sky-300 px-1.5 py-px text-[10.5px] font-medium text-sky-800 dark:border-sky-800 dark:text-sky-300">
                          <Handshake className="size-3" /> Sem passagem do Fred
                        </span>
                      ) : null}
                    </p>
                  </ClientCard>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function DaysText({ row, className }: { row: JourneyRow; className?: string }) {
  const text = daysInStageText(row.journey);
  if (!text) {
    return row.journey.stage === "onboarding" ? (
      <span className={cn("text-muted-foreground/70", className)}>sem data de cadastro</span>
    ) : null;
  }
  const stale = row.journey.stage === "onboarding" && (row.journey.daysInStage ?? 0) > 7;
  return (
    <span
      className={cn(
        "tabular-nums text-muted-foreground",
        stale && "font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Rodando                                                              */
/* ------------------------------------------------------------------ */

function RodandoColumn({
  rows,
  range,
  onMessage,
  forceOpen,
}: {
  rows: JourneyRow[];
  range: WorkspaceRange;
  onMessage: (row: JourneyRow) => void;
  forceOpen: boolean;
}) {
  const [attentionOpen, setAttentionOpen] = useState(true);
  const [calmOpen, setCalmOpen] = useState(false);
  if (rows.length === 0) return <EmptyColumn />;
  const attention = rows
    .filter((row) => row.journey.needsAttention)
    .sort(
      (a, b) =>
        PLAN_RANK[a.client.plan.tier] - PLAN_RANK[b.client.plan.tier] ||
        b.journey.attentionReasons.length - a.journey.attentionReasons.length ||
        b.client.perf.current.spend - a.client.perf.current.spend,
    );
  const calm = rows
    .filter((row) => !row.journey.needsAttention)
    .sort(
      (a, b) =>
        PLAN_RANK[a.client.plan.tier] - PLAN_RANK[b.client.plan.tier] ||
        b.client.perf.current.spend - a.client.perf.current.spend,
    );
  const showCalm = calmOpen || (forceOpen && calm.length <= 12);

  return (
    <>
      {attention.length > 0 ? (
        <div className="space-y-1.5">
          <GroupHeader
            open={attentionOpen}
            onToggle={() => setAttentionOpen((value) => !value)}
            title="Precisa de atenção"
            count={attention.length}
            tone="attention"
            hint="Fora da meta, sem resultado ou com alerta de performance."
          />
          {attentionOpen ? (
            <ul className="space-y-1.5">
              {attention.map((row) => {
                const { kpi, previousKpi, current } = row.client.perf;
                const line = attentionLine(row.journey);
                return (
                  <ClientCard key={row.client.userId} row={row} onMessage={onMessage}>
                    <p className="truncate text-xs font-medium text-red-700 dark:text-red-400" title={line}>
                      {line}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {formatMoney(current.spend, false)} em {range.days} dias
                      </span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {kpi.count > 0 ? `${kpi.costLabel} ${formatMoney(kpi.cost)}` : `0 ${kpi.label.toLowerCase()}`}
                        {kpi.count > 0 ? <Delta value={delta(kpi.cost, previousKpi.cost)} goodWhenUp={false} className="text-[11px]" /> : null}
                      </span>
                      <span aria-hidden>·</span>
                      <DaysText row={row} />
                    </p>
                  </ClientCard>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {calm.length > 0 ? (
        <div className="space-y-1.5">
          <GroupHeader
            open={showCalm}
            onToggle={() => setCalmOpen((value) => !value)}
            title="Tudo certo"
            count={calm.length}
            tone="calm"
            hint={showCalm ? undefined : "Na meta ou sem meta definida, sem alerta de performance."}
          />
          {showCalm ? (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {calm.map((row) => (
                <CompactRow key={row.client.userId} row={row} range={range} onMessage={onMessage} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CompactRow({
  row,
  range,
  onMessage,
}: {
  row: JourneyRow;
  range: WorkspaceRange;
  onMessage: (row: JourneyRow) => void;
}) {
  const { client, journey } = row;
  const href = clientHref(client.userId);
  const days = daysInStageText(journey);
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <Link
        href={href}
        className="min-w-0 flex-1 truncate text-[13px] hover:underline"
        title={`${client.displayName}${days ? ` · ${days}` : ""}`}
      >
        {client.displayName}
      </Link>
      {journey.tags.length > 0 ? (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label={`${journey.tags.length} tag(s)`} />
          </TooltipTrigger>
          <TooltipContent className="text-xs">{journey.tags.map((tag) => tag.label).join(" · ")}</TooltipContent>
        </Tooltip>
      ) : null}
      <PlanBadge tier={client.plan.tier} />
      <span
        className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground"
        title={`Investido nos últimos ${range.days} dias`}
      >
        {formatMoney(client.perf.current.spend, false)}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Mensagem para ${client.displayName}`}
        title="Mensagem"
        onClick={() => onMessage(row)}
      >
        <MessageSquare />
      </Button>
      <Button size="icon-xs" variant="ghost" asChild aria-label={`Abrir ${client.displayName}`} title="Abrir">
        <Link href={href}>
          <ArrowRight />
        </Link>
      </Button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Parado                                                               */
/* ------------------------------------------------------------------ */

function ParadoColumn({
  rows,
  stopped,
  onMessage,
}: {
  rows: JourneyRow[];
  stopped: Record<string, StoppedSpend>;
  onMessage: (row: JourneyRow) => void;
}) {
  if (rows.length === 0) return <EmptyColumn />;
  const sorted = [...rows].sort(
    (a, b) =>
      (stopped[b.client.userId]?.weekSpend ?? 0) - (stopped[a.client.userId]?.weekSpend ?? 0) ||
      (a.journey.daysInStage ?? 999) - (b.journey.daysInStage ?? 999),
  );
  const lost = sorted.reduce((sum, row) => sum + (stopped[row.client.userId]?.weekSpend ?? 0), 0);
  return (
    <>
      <p className="px-1 text-[11px] text-muted-foreground">
        Ordenado pelo dinheiro que parou: somados, rodavam{" "}
        <span className="font-medium text-foreground tabular-nums">{formatMoney(lost, false)}/semana</span>.
      </p>
      <ul className="space-y-1.5">
        {sorted.map((row) => {
          const week = stopped[row.client.userId]?.weekSpend ?? 0;
          return (
            <ClientCard key={row.client.userId} row={row} onMessage={onMessage}>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <DaysText row={row} />
                {week > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      rodava <span className="font-medium text-foreground">{formatMoney(week, false)}/semana</span>
                    </span>
                  </>
                ) : null}
              </p>
            </ClientCard>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cartão                                                               */
/* ------------------------------------------------------------------ */

function ClientCard({
  row,
  onMessage,
  children,
}: {
  row: JourneyRow;
  onMessage: (row: JourneyRow) => void;
  children?: React.ReactNode;
}) {
  const { client, journey } = row;
  const href = clientHref(client.userId);
  const autoTags = new Set(journey.autoTags);
  const hasChips = journey.tags.length > 0 || journey.billingRisk;
  return (
    <li className="rounded-lg border bg-card p-2.5 shadow-xs transition-colors hover:border-primary/40">
      <div className="flex items-start gap-2">
        <Link
          href={href}
          className="min-w-0 flex-1 truncate text-sm leading-5 font-medium hover:underline"
          title={client.displayName}
        >
          {client.displayName}
        </Link>
        <PlanBadge tier={client.plan.tier} className="mt-0.5 shrink-0" />
      </div>
      <div className="mt-1 space-y-1">{children}</div>
      {hasChips ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {journey.tags.map((tag) => (
            <ProblemTagChip key={tag.key} tag={tag} auto={autoTags.has(tag.key)} />
          ))}
          {journey.billingRisk ? <FinanceChip text={journey.billingRisk} /> : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        {client.phone ? (
          <span className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">{formatPhone(client.phone)}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">sem telefone</span>
        )}
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => onMessage(row)}>
          <MessageSquare /> Mensagem
        </Button>
        <Button size="xs" variant="secondary" asChild>
          <Link href={href}>Abrir</Link>
        </Button>
      </div>
    </li>
  );
}
