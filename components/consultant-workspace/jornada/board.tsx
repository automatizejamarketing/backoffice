"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Handshake, Info, MessageSquare, Search, Wallet, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STAGE_DESCRIPTION,
  STAGE_LABEL,
  type JourneyExtras,
  type JourneyStage,
  type JourneyStepKey,
} from "@/lib/consultant-workspace/journey";
import { PLAN_RANK, formatMoney } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient, WorkspaceRange, WorkspaceState } from "@/lib/consultant-workspace/types";
import { useAssignmentOverrides } from "@/components/consultant-workspace/common/assignment";
import { useConsultantScope } from "@/components/consultant-workspace/common/consultant-scope";
import { HintIcon, NEXT_STEP_TONE, PlanText, StageDot } from "@/components/consultant-workspace/common/journey-bits";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import {
  buildRows,
  daysInStageText,
  handledTodayCount,
  planGroupOf,
  type PlanGroup,
} from "@/components/consultant-workspace/common/model";
import { extraTags, nextStep, type NextStep } from "@/components/consultant-workspace/common/next-step";
import { clientHref } from "@/components/consultant-workspace/common/routes";
import { SummaryStrip, computeStripCounts } from "@/components/consultant-workspace/common/summary-strip";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useWorkspaceMe } from "@/components/consultant-workspace/common/workspace-context";
import {
  isProblemFilter,
  matchesProblem,
  problemCounts,
  replaceParams,
} from "@/components/consultant-workspace/carteira/filters";
import { TagFilter } from "@/components/consultant-workspace/carteira/strip-filters";
import { TemplateComposerDialog, type ComposerTarget } from "@/components/consultant-workspace/cliente/composer";
import { consultantOf, fillAlert, plural, primaryTemplateKey, type SlimAlert, type StoppedSpend } from "./lib";
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
const PLAN_NAME: Record<PlanGroup, string> = { premium: "Premium", pro: "Pro", starter: "Starter" };

/** Cartões por grupo antes do "ver mais". */
const GROUP_PREVIEW = 5;

const TONE_RANK: Record<NextStep["tone"], number> = { critical: 0, attention: 1, neutral: 2 };

type Card = JourneyRow & { step: NextStep | null };

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
 * Jornada: cada cliente na etapa em que está (onboarding, rodando, parado).
 * Cada cartão diz UMA coisa — o próximo passo — e o contexto numa linha
 * apagada; sinais secundários viram ícones com dica. O resumo por plano no
 * topo é o mesmo da Fila e da Mesa.
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
  /** Relógio da leitura (servidor): base de "há N dias", nunca `Date.now()` no render. */
  now: number;
}) {
  const me = useWorkspaceMe();
  const { store } = usePrimedWorkspaceState(initialStore, now);
  const scope = useConsultantScope();
  const assignments = useAssignmentOverrides();
  const params = useSearchParams();
  const rawTag = params.get("tag");
  const tagFilter = isProblemFilter(rawTag) ? rawTag : null;
  const rawPlan = params.get("plano") as PlanGroup | null;
  const plan = rawPlan && PLAN_GROUPS.includes(rawPlan) ? rawPlan : null;
  const [search, setSearch] = useState("");
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

  const cards = useMemo<Card[]>(
    () =>
      rows.map((row) => ({
        ...row,
        step: nextStep(row.client, row.journey, {
          alerts: row.alerts,
          stopped: stopped[row.client.userId] ?? null,
          goal: store.goals[row.client.userId] ?? null,
        }),
      })),
    [rows, stopped, store.goals],
  );

  const inScope = useMemo(
    () =>
      cards.filter(
        ({ client }) => matchesScope(consultantOf(client, assignments)) && matchesSearch(client, search.trim()),
      ),
    [cards, matchesScope, assignments, search],
  );
  const scoped = useMemo(
    () => inScope.filter(({ client }) => !plan || planGroupOf(client.plan.tier) === plan),
    [inScope, plan],
  );

  const strip = useMemo(() => {
    const ids = new Set(
      inScope.filter(({ journey }) => matchesProblem(journey, tagFilter)).map(({ client }) => client.userId),
    );
    return computeStripCounts(carteiraRows.filter((row) => ids.has(row.userId)));
  }, [inScope, carteiraRows, tagFilter]);

  const tagCounts = useMemo(() => problemCounts(scoped.map((row) => row.journey)), [scoped]);

  const visible = scoped.filter(({ journey }) => matchesProblem(journey, tagFilter));
  const byStage = (stage: JourneyStage) => visible.filter((row) => row.journey.stage === stage);
  const onboarding = byStage("onboarding");
  const rodando = byStage("rodando");
  const parado = byStage("parado");
  const lost = parado.reduce((sum, row) => sum + (stopped[row.client.userId]?.weekSpend ?? 0), 0);

  function setParam(key: string, value: string | null) {
    replaceParams((query) => {
      if (value) query.set(key, value);
      else query.delete(key);
    });
  }

  const openMessage = (row: JourneyRow) =>
    setComposer({ client: row.client, journey: row.journey, templateKey: primaryTemplateKey(row.journey, row.client) });

  const filtersActive = Boolean(tagFilter || search.trim() || plan);
  const card = (row: Card) => (
    <ClientCard key={row.client.userId} row={row} context={contextLine(row, range)} onMessage={openMessage} />
  );

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-2 px-4 pt-3 pb-2 lg:px-6">
        <SummaryStrip
          counts={strip.counts}
          plan={plan}
          onPlan={(next) => setParam("plano", next)}
          handled={handled}
          remaining={strip.remaining}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight whitespace-nowrap">Jornada dos clientes</h1>
            <p className="truncate text-xs text-muted-foreground" title={`Gasto até ontem (${range.days} dias)`}>
              {plural(scoped.length, "cliente ativo", "clientes ativos")}
              {scope.filtered ? ` · carteira: ${scope.label}` : ""}
              {plan ? ` · plano ${PLAN_NAME[plan]}` : ""}
            </p>
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            <TagFilter counts={tagCounts} tag={tagFilter} onTag={(next) => setParam("tag", next)} />
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  replaceParams((query) => {
                    query.delete("tag");
                    query.delete("plano");
                  });
                  setSearch("");
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" /> Limpar filtros
              </button>
            ) : null}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar cliente, e-mail ou telefone"
                className="h-7 pl-8 text-xs"
                aria-label="Buscar cliente"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 px-4 pb-4 lg:px-6 @3xl:min-h-[420px] @3xl:flex-1 @3xl:grid-cols-3">
        <StageColumn stage="onboarding" count={onboarding.length}>
          <OnboardingColumn rows={onboarding} render={card} />
        </StageColumn>
        <StageColumn stage="rodando" count={rodando.length}>
          <RodandoColumn rows={rodando} render={card} forceOpen={filtersActive} />
        </StageColumn>
        <StageColumn
          stage="parado"
          count={parado.length}
          aside={lost > 0 ? `${formatMoney(lost, false)}/semana` : null}
          asideHint={`Somados, estes clientes rodavam ${formatMoney(lost, false)} por semana antes de parar. Ordenados pelo dinheiro que parou.`}
        >
          <ParadoColumn rows={parado} stopped={stopped} render={card} />
        </StageColumn>
      </div>

      <TemplateComposerDialog target={composer} onClose={() => setComposer(null)} />
    </div>
  );
}

/** Linha 3 do cartão: há quanto tempo na etapa e, rodando, o gasto do período. */
function contextLine(row: Card, range: WorkspaceRange): string | null {
  const days = daysInStageText(row.journey);
  if (row.journey.stage === "onboarding") return days ?? "sem data de cadastro";
  if (row.journey.stage === "parado") return days ?? "sem gasto no período";
  const spend = `${formatMoney(row.client.perf.current.spend, false)} em ${range.days} dias`;
  return days ? `${days} · ${spend}` : spend;
}

function StageColumn({
  stage,
  count,
  aside,
  asideHint,
  children,
}: {
  stage: JourneyStage;
  count: number;
  aside?: string | null;
  asideHint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-xl border bg-muted/30 @3xl:min-h-0"
      aria-labelledby={`etapa-${stage}`}
    >
      <header className="flex min-w-0 items-center gap-1.5 border-b px-3 py-2">
        <h2 id={`etapa-${stage}`} className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          <StageDot stage={stage} />
          {STAGE_LABEL[stage]}
          <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </h2>
        <HintIcon label={`Sobre a etapa ${STAGE_LABEL[stage]}`} tooltip={STAGE_DESCRIPTION[stage]} side="bottom">
          <Info className="size-3.5" />
        </HintIcon>
        {aside ? (
          <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground tabular-nums" title={asideHint}>
            {aside}
          </span>
        ) : null}
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
  note,
  hint,
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  count: number;
  /** Texto curto apagado ao lado do título. */
  note?: string;
  /** Explicação do grupo, no ícone de dica. */
  hint?: string;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs hover:bg-muted/60"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          <span className="font-semibold">{title}</span>{" "}
          <span className="tabular-nums text-muted-foreground">({count})</span>
          {note ? <span className="text-muted-foreground"> · {note}</span> : null}
        </span>
      </button>
      {hint ? (
        <HintIcon label={hint}>
          <Info className="size-3.5" />
        </HintIcon>
      ) : null}
    </div>
  );
}

/** Os primeiros cartões do grupo e um "ver mais N" para o resto. */
function CardList({ rows, render, label }: { rows: Card[]; render: (row: Card) => React.ReactNode; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, GROUP_PREVIEW);
  const rest = rows.length - GROUP_PREVIEW;
  return (
    <>
      <ul className="space-y-1.5" aria-label={label}>
        {shown.map(render)}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="w-full rounded-md py-1 text-center text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {expanded ? "ver menos" : `ver mais ${rest}`}
        </button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding: agrupado pelo passo que trava                            */
/* ------------------------------------------------------------------ */

function OnboardingColumn({ rows, render }: { rows: Card[]; render: (row: Card) => React.ReactNode }) {
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
              note={stale > 0 ? `${stale} há mais de 7 dias` : undefined}
            />
            {open ? <CardList rows={group.rows} render={render} label={`Travados em ${BLOCKER_LABEL[group.key]}`} /> : null}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rodando: precisa de atenção / tudo certo                             */
/* ------------------------------------------------------------------ */

function RodandoColumn({
  rows,
  render,
  forceOpen,
}: {
  rows: Card[];
  render: (row: Card) => React.ReactNode;
  forceOpen: boolean;
}) {
  const [attentionOpen, setAttentionOpen] = useState(true);
  const [calmOpen, setCalmOpen] = useState(false);
  if (rows.length === 0) return <EmptyColumn />;
  const needsAction = (row: Card) => row.step != null && row.step.tone !== "neutral";
  const attention = rows
    .filter(needsAction)
    .sort(
      (a, b) =>
        TONE_RANK[a.step!.tone] - TONE_RANK[b.step!.tone] ||
        PLAN_RANK[a.client.plan.tier] - PLAN_RANK[b.client.plan.tier] ||
        b.client.perf.current.spend - a.client.perf.current.spend,
    );
  const calm = rows
    .filter((row) => !needsAction(row))
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
            hint="Facebook desconectado, gasto sem resultado, fora da meta ou com alerta de performance. Mais grave primeiro."
          />
          {attentionOpen ? <CardList rows={attention} render={render} label="Rodando, precisa de atenção" /> : null}
        </div>
      ) : null}

      {calm.length > 0 ? (
        <div className="space-y-1.5">
          <GroupHeader
            open={showCalm}
            onToggle={() => setCalmOpen((value) => !value)}
            title="Tudo certo"
            count={calm.length}
            hint="Na meta ou sem meta definida, sem alerta de performance."
          />
          {showCalm ? <CardList rows={calm} render={render} label="Rodando, tudo certo" /> : null}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Parado: pelo dinheiro que parou                                      */
/* ------------------------------------------------------------------ */

function ParadoColumn({
  rows,
  stopped,
  render,
}: {
  rows: Card[];
  stopped: Record<string, StoppedSpend>;
  render: (row: Card) => React.ReactNode;
}) {
  if (rows.length === 0) return <EmptyColumn />;
  const sorted = [...rows].sort(
    (a, b) =>
      (stopped[b.client.userId]?.weekSpend ?? 0) - (stopped[a.client.userId]?.weekSpend ?? 0) ||
      (a.journey.daysInStage ?? 999) - (b.journey.daysInStage ?? 999),
  );
  return <CardList rows={sorted} render={render} label="Parados, pelo dinheiro que parou" />;
}

/* ------------------------------------------------------------------ */
/* Cartão: nome · próximo passo · contexto                              */
/* ------------------------------------------------------------------ */

function ClientCard({
  row,
  context,
  onMessage,
}: {
  row: Card;
  context: string | null;
  onMessage: (row: JourneyRow) => void;
}) {
  const { client, journey, step } = row;
  const href = clientHref(client.userId);
  const extra = extraTags(journey.tags, step);
  const noHandoff = journey.stage === "onboarding" && !journey.handoff;
  return (
    <li className="group relative rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-foreground/25">
      <div className="flex min-w-0 items-center gap-1.5">
        {/* O link cobre o cartão inteiro (::after); ícones e botão ficam por cima. */}
        <Link
          href={href}
          title={client.displayName}
          className="min-w-0 truncate text-sm leading-5 font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
        >
          {client.displayName}
        </Link>
        <PlanText tier={client.plan.tier} />
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {noHandoff ? (
            <HintIcon
              label="Sem passagem do Fred"
              tooltip="Sem passagem de bastão do Fred — peça o resumo da call antes de falar com o cliente."
            >
              <Handshake className="size-3.5" />
            </HintIcon>
          ) : null}
          {journey.billingRisk ? (
            <HintIcon label={`Financeiro: ${journey.billingRisk.toLowerCase()}`}>
              <Wallet className="size-3.5" />
            </HintIcon>
          ) : null}
          {extra.length > 0 ? (
            <HintIcon
              label={`Mais ${plural(extra.length, "problema", "problemas")}: ${extra.map((tag) => tag.label).join(", ")}`}
              tooltip={
                <ul className="space-y-0.5">
                  {extra.map((tag) => (
                    <li key={tag.key}>{tag.label}</li>
                  ))}
                </ul>
              }
            >
              <span className="text-[11px] tabular-nums">+{extra.length}</span>
            </HintIcon>
          ) : null}
          <button
            type="button"
            onClick={() => onMessage(row)}
            aria-label={`Mensagem para ${client.displayName}`}
            title="Mensagem"
            // Só aparece no hover/foco do cartão e não reserva espaço escondido: o nome usa a linha toda.
            className="relative z-10 inline-flex h-6 w-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 transition-[width,opacity] outline-none group-focus-within:w-6 group-focus-within:opacity-100 group-hover:w-6 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:w-6 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MessageSquare className="size-3.5" />
          </button>
        </span>
      </div>
      {step ? (
        <p className={cn("line-clamp-2 text-[13px] leading-snug", NEXT_STEP_TONE[step.tone])} title={step.text}>
          {step.text}
        </p>
      ) : null}
      {context ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">{context}</p> : null}
    </li>
  );
}
