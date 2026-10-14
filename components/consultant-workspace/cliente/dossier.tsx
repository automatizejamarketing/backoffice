"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Film,
  ImageIcon,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Repeat2,
  Sparkles,
  Target,
  Wallet,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TEMPLATE_BY_KEY } from "@/lib/consultant-workspace/journey";
import type { DossierAd } from "@/lib/consultant-workspace/journey-data";
import {
  GOAL_KPI_LABEL,
  budgetPacing,
  delta,
  formatDay,
  formatInt,
  formatMoney,
  formatRelative,
  formatRoas,
  goalStatus,
} from "@/lib/consultant-workspace/metrics";
import type {
  WorkspaceAiAnalysis,
  WorkspaceAlert,
  WorkspaceCampaign,
  WorkspaceClient,
  WorkspaceClientDetail,
  WorkspaceRange,
  WorkspaceSimulatedAction,
  WorkspaceState,
} from "@/lib/consultant-workspace/types";
import { Delta, GoalBadge, SeverityDot } from "@/components/consultant-workspace/shared/primitives";
import {
  GoalEditorDialog,
  MetaActionDialog,
  ResolveAlertForm,
  snoozeUntil,
} from "@/components/consultant-workspace/shared/actions";
import { WORKSPACE_STATE_KEY, useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { PERIOD_OPTIONS } from "@/components/consultant-workspace/common/routes";
import { humanize, humanizeName } from "@/components/consultant-workspace/common/signal-helpers";
import {
  CAMPAIGN_STATUS_LABEL,
  OBJECTIVE_LABEL,
  clientSentenceFrom,
  isAlertLive,
  isOtherAreaAlert,
  kpiUnit,
  parseAiAnalysis,
  renderMessage,
  plural,
  toIso,
} from "@/components/consultant-workspace/jornada/lib";

export function Section({
  title,
  icon: Icon,
  subtitle,
  right,
  children,
  className,
}: {
  title: string;
  icon?: typeof Bot;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base leading-tight font-semibold">
            {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 text-xs text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Números do período                                                */
/* ------------------------------------------------------------------ */

export function PeriodTabs({ days }: { days: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {pending ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
      <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="tablist" aria-label="Período">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === days}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              if (option === 7) params.delete("dias");
              else params.set("dias", String(option));
              const query = params.toString();
              startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
            }}
            className={cn(
              "rounded-[5px] px-2.5 py-0.5 text-xs tabular-nums transition-colors",
              option === days ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option} dias
          </button>
        ))}
      </div>
    </div>
  );
}

export function KpiStrip({ client, range, store }: { client: WorkspaceClient; range: WorkspaceRange; store: WorkspaceState }) {
  const [goalOpen, setGoalOpen] = useState(false);
  const { kpi, previousKpi, current, previous } = client.perf;
  const goal = store.goals[client.userId];
  const evaluation = goalStatus(kpi, goal);
  const pacing = budgetPacing(client.perf.monthToDateSpend, goal?.monthlyBudget, range);
  const ctr = current.impressions > 0 ? current.linkClicks / current.impressions : null;
  const prevCtr = previous.impressions > 0 ? previous.linkClicks / previous.impressions : null;
  const cards: Array<{
    label: string;
    value: string;
    hint: string;
    delta: number | null;
    goodWhenUp?: boolean;
    neutral?: boolean;
  }> = [
    {
      label: "Investido",
      value: formatMoney(current.spend, false),
      hint: `antes ${formatMoney(previous.spend, false)}`,
      delta: delta(current.spend, previous.spend),
      neutral: true,
    },
    {
      label: kpi.label,
      value: formatInt(kpi.count),
      hint: `antes ${formatInt(previousKpi.count)}`,
      delta: delta(kpi.count, previousKpi.count),
    },
    {
      label: kpi.costLabel,
      // Sem gasto no período (resultado atribuído atrasado) o custo não diz nada.
      value: formatMoney(current.spend > 0 ? kpi.cost : null),
      hint: `antes ${formatMoney(previous.spend > 0 ? previousKpi.cost : null)}`,
      delta: current.spend > 0 ? delta(kpi.cost, previousKpi.cost) : null,
      goodWhenUp: false,
    },
    kpi.kind === "compras"
      ? {
          label: "ROAS",
          value: formatRoas(kpi.roas),
          hint: `${formatMoney(current.purchaseValue, false)} em vendas`,
          delta: delta(kpi.roas, previousKpi.roas),
        }
      : {
          label: "CTR (link)",
          value: ctr == null ? "—" : `${(ctr * 100).toFixed(2).replace(".", ",")}%`,
          hint: `${formatInt(current.linkClicks)} cliques`,
          delta: delta(ctr, prevCtr),
        },
  ];

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{card.value}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-muted-foreground">{card.hint}</span>
              <Delta value={card.delta} goodWhenUp={card.goodWhenUp} neutral={card.neutral} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border bg-card px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Target className="size-3.5" /> Meta combinada
          </p>
          {goal ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium">
                {GOAL_KPI_LABEL[goal.kpi]} {goal.kpi === "roas" ? formatRoas(goal.target) : formatMoney(goal.target)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                atual {goal.kpi === "roas" ? formatRoas(evaluation.actual) : formatMoney(evaluation.actual)}
              </span>
              <GoalBadge kpi={kpi} goal={goal} />
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem meta — combine o {kpi.costLabel} aceitável e a verba do mês com o cliente.
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wallet className="size-3.5" /> Verba do mês
          </p>
          {pacing && goal?.monthlyBudget ? (
            <PacingBar spent={client.perf.monthToDateSpend} budget={goal.monthlyBudget} {...pacing} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {formatMoney(client.perf.monthToDateSpend, false)} gastos no mês · sem verba combinada
            </p>
          )}
        </div>
        <Button size="sm" variant={goal ? "outline" : "default"} onClick={() => setGoalOpen(true)}>
          {goal ? <Pencil className="size-3.5" /> : <Target className="size-3.5" />}
          {goal ? "Editar meta" : "Definir meta"}
        </Button>
      </div>
      {goalOpen ? (
        <GoalEditorDialog
          open={goalOpen}
          onOpenChange={setGoalOpen}
          userId={client.userId}
          clientName={client.displayName}
          kpi={kpi}
          goal={goal}
        />
      ) : null}
    </div>
  );
}

function PacingBar({
  spent,
  budget,
  expected,
  ratio,
  projected,
}: {
  spent: number;
  budget: number;
  expected: number;
  ratio: number;
  projected: number;
}) {
  const spentPct = Math.min(100, (spent / budget) * 100);
  const expectedPct = Math.min(100, (expected / budget) * 100);
  const tone = ratio < 0.8 ? "bg-amber-500" : ratio > 1.15 ? "bg-red-500" : "bg-emerald-500";
  const label = ratio < 0.8 ? "abaixo do ritmo" : ratio > 1.15 ? "acima do ritmo" : "no ritmo";
  return (
    <div className="space-y-1">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${spentPct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `calc(${expectedPct}% - 1px)` }} />
      </div>
      <p className="text-[11px] leading-tight text-muted-foreground tabular-nums">
        {formatMoney(spent, false)} de {formatMoney(budget, false)} ·{" "}
        <span
          className={cn(
            ratio < 0.8 && "text-amber-700 dark:text-amber-400",
            ratio > 1.15 && "text-red-700 dark:text-red-400",
          )}
        >
          {label} ({Math.round(ratio * 100)}%)
        </span>{" "}
        · projeção {formatMoney(projected, false)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Análise da IA                                                     */
/* ------------------------------------------------------------------ */

const AI_STEPS = [
  "Lendo campanhas e criativos…",
  "Comparando com o período anterior…",
  "Cruzando com a meta e os alertas…",
  "Escrevendo o que fazer agora…",
];

function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold">
            {part}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function AiAnalysisCard({
  userId,
  days,
  analysis,
  onUseSentence,
}: {
  userId: string;
  days: number;
  analysis: WorkspaceAiAnalysis | undefined;
  onUseSentence: (sentence: string) => void;
}) {
  const queryClient = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/consultant-workspace/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, days }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao gerar a análise");
      }
      return (await response.json()) as WorkspaceAiAnalysis;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_STATE_KEY });
      toast.success("Análise pronta");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao gerar a análise"),
  });
  const pending = mutation.isPending;

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [pending]);

  const sections = useMemo(() => (analysis ? parseAiAnalysis(analysis.text) : []), [analysis]);
  const sentence = clientSentenceFrom(analysis?.text);
  const step = AI_STEPS[Math.min(AI_STEPS.length - 1, Math.floor(elapsed / 4))];

  function generate() {
    if (pending) return;
    setElapsed(0);
    mutation.mutate();
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
        <p className="text-sm font-semibold">Análise da IA</p>
        {analysis ? (
          <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
            gerada {formatRelative(analysis.generatedAt)} por {analysis.by} · período {analysis.periodDays} dias
          </p>
        ) : null}
        <Button
          size="xs"
          variant={analysis ? "outline" : "default"}
          className="ml-auto"
          onClick={generate}
          disabled={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : analysis ? <RefreshCw /> : <Wand2 />}
          {pending ? "Gerando…" : analysis ? "Atualizar" : "Gerar análise"}
        </Button>
      </div>

      {pending ? (
        <div className="space-y-2 px-3 py-4" aria-live="polite">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin text-violet-600" /> {step}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500 transition-[width] duration-500"
              style={{ width: `${Math.min(95, (elapsed / 18) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Leva uns 15 segundos · {elapsed}s · usa os números de {days} dias desta tela
          </p>
        </div>
      ) : analysis ? (
        <div className="space-y-3 px-3 py-3">
          {analysis.periodDays !== days ? (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Esta análise olhou {analysis.periodDays} dias; você está vendo {days}. Atualize para alinhar.
            </p>
          ) : null}
          <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
            {sections
              .filter((section) => !section.title?.toLowerCase().includes("dizer ao cliente"))
              .map((section, index) => (
                <div key={`${section.title}-${index}`} className={cn("min-w-0 space-y-1", section.lines.some((line) => line.kind === "bullet") && "lg:col-span-2")}>
                  {section.title ? <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h3> : null}
                  {section.lines.some((line) => line.kind === "bullet") ? (
                    <ul className="space-y-1">
                      {section.lines.map((line, lineIndex) =>
                        line.kind === "bullet" ? (
                          <li key={lineIndex} className="flex gap-2 text-sm leading-relaxed">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-violet-500" />
                            <span className="min-w-0">
                              <RichText text={line.text} />
                            </span>
                          </li>
                        ) : (
                          <li key={lineIndex} className="text-sm leading-relaxed">
                            <RichText text={line.text} />
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    section.lines.map((line, lineIndex) => (
                      <p key={lineIndex} className="text-sm leading-relaxed">
                        <RichText text={line.text} />
                      </p>
                    ))
                  )}
                </div>
              ))}
          </div>
          {sentence ? (
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/30">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold tracking-wide text-violet-800 uppercase dark:text-violet-300">
                  Para dizer ao cliente
                </p>
                <p className="text-sm leading-relaxed">“{sentence}”</p>
              </div>
              <Button size="xs" variant="outline" onClick={() => onUseSentence(sentence)}>
                <MessageSquareText /> Usar no resumo
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          {mutation.isError ? (
            <p className="mb-1 text-red-700 dark:text-red-400">Não deu certo desta vez. Tente de novo em instantes.</p>
          ) : null}
          <p>
            Uma leitura curta dos últimos {days} dias: o que aconteceu, a hipótese, até 3 ações (otimizar, pausar ou
            trocar criativo, ajustar verba) e uma frase pronta para o cliente. Só roda quando você clica.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Relatório padrão (campanhas)                                      */
/* ------------------------------------------------------------------ */

type DialogState = { entityId: string; entityName: string; action: WorkspaceSimulatedAction["action"]; budget?: number | null };

/** Nome legível de campanha/anúncio: sem as tags automáticas nem o número da Meta. */
function entityDisplayName(name: string | null | undefined, id: string, kind: "Campanha" | "Anúncio") {
  if (!name || name === id || /^\d{8,}$/.test(name.trim())) return `${kind} sem nome`;
  return humanizeName(name);
}

/** Ação na Meta: prévia ao vivo → confirmar. Ao fechar, relê a página (status e histórico). */
function useMetaActionDialog() {
  const router = useRouter();
  const [dialog, setDialogNow] = useState<DialogState | null>(null);
  // Aberto a partir de um menu suspenso: o menu devolve o foco ao botão ao
  // fechar e o diálogo entenderia isso como clique fora. Abre no próximo ciclo.
  function setDialog(next: DialogState | null) {
    if (next) setTimeout(() => setDialogNow(next), 0);
    else setDialogNow(null);
  }
  function close() {
    const changedMeta = dialog && !["otimizar", "trocar_criativo"].includes(dialog.action);
    setDialogNow(null);
    if (changedMeta) router.refresh();
  }
  return { dialog, setDialog, close };
}

export function CampaignReport({ detail, range }: { detail: WorkspaceClientDetail; range: WorkspaceRange }) {
  const { dialog, setDialog, close } = useMetaActionDialog();
  const [showAll, setShowAll] = useState(false);
  const campaigns = detail.campaigns;
  const { client } = detail;
  const hasRoas = campaigns.some((campaign) => campaign.kpi.roas != null) || client.perf.kpi.roas != null;
  const list = showAll ? campaigns : campaigns.slice(0, 8);

  return (
    <Section
      title="Relatório padrão"
      icon={MessageSquareText}
      subtitle={`Campanhas de ${formatDay(range.from)} a ${formatDay(range.to)} contra ${formatDay(range.prevFrom)} a ${formatDay(range.prevTo)}`}
    >
      {campaigns.length === 0 ? (
        <Empty title="Nenhuma campanha com dados">A coleta não achou veiculação neste período nem no anterior.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Campanha</th>
                <th className="px-3 py-2 text-right font-medium">Investido</th>
                <th className="px-3 py-2 text-right font-medium">Resultado</th>
                <th className="px-3 py-2 text-right font-medium">Custo</th>
                {hasRoas ? <th className="px-3 py-2 text-right font-medium">ROAS</th> : null}
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((campaign) => (
                <CampaignRow
                  key={campaign.campaignId}
                  campaign={campaign}
                  hasRoas={hasRoas}
                  onAction={(action) =>
                    setDialog({
                      entityId: campaign.campaignId,
                      entityName: entityDisplayName(campaign.name, campaign.campaignId, "Campanha"),
                      action,
                      budget: campaign.dailyBudget,
                    })
                  }
                />
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-xs">
              <tr>
                <td className="px-3 py-2 font-medium">Total da conta</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="block font-medium">{formatMoney(client.perf.current.spend, false)}</span>
                  <Delta value={delta(client.perf.current.spend, client.perf.previous.spend)} neutral />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="block font-medium">{formatInt(client.perf.kpi.count)}</span>
                  <span className="text-[11px] text-muted-foreground">{kpiUnit(client.perf.kpi.count, client.perf.kpi.label)}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="block font-medium">
                    {formatMoney(client.perf.current.spend > 0 ? client.perf.kpi.cost : null)}
                  </span>
                  <Delta
                    value={client.perf.current.spend > 0 ? delta(client.perf.kpi.cost, client.perf.previousKpi.cost) : null}
                    goodWhenUp={false}
                  />
                </td>
                {hasRoas ? (
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatRoas(client.perf.kpi.roas)}</td>
                ) : null}
                <td />
              </tr>
            </tfoot>
          </table>
          {campaigns.length > 8 ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="w-full border-t px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {showAll ? "Mostrar só as 8 de maior gasto" : `Ver todas as ${campaigns.length} campanhas`}
            </button>
          ) : null}
        </div>
      )}
      {dialog ? (
        <MetaActionDialog
          key={`${dialog.entityId}-${dialog.action}`}
          open
          onOpenChange={(open) => (open ? null : close())}
          userId={client.userId}
          entityId={dialog.entityId}
          entityName={dialog.entityName}
          action={dialog.action}
          currentBudget={dialog.budget}
        />
      ) : null}
    </Section>
  );
}

function CampaignRow({
  campaign,
  hasRoas,
  onAction,
}: {
  campaign: WorkspaceCampaign;
  hasRoas: boolean;
  onAction: (action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const rawStatus = campaign.effectiveStatus ?? campaign.status ?? "";
  const status = CAMPAIGN_STATUS_LABEL[rawStatus] ?? (rawStatus ? "Outro status" : "—");
  const name = entityDisplayName(campaign.name, campaign.campaignId, "Campanha");
  const isActive = rawStatus === "ACTIVE";
  const objective = campaign.objective ? (OBJECTIVE_LABEL[campaign.objective] ?? "Outro objetivo") : null;
  const budget = campaign.dailyBudget
    ? `${formatMoney(campaign.dailyBudget, false)}/dia`
    : campaign.lifetimeBudget
      ? `${formatMoney(campaign.lifetimeBudget, false)} total`
      : null;
  return (
    <tr className="align-top">
      <td className="max-w-[320px] px-3 py-2">
        <p className="truncate font-medium" title={name}>
          {name}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-zinc-400")} />
          {status}
          {objective ? <span>· {objective}</span> : null}
          {budget ? <span>· {budget}</span> : null}
        </p>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="block">{formatMoney(campaign.current.spend, false)}</span>
        <Delta value={delta(campaign.current.spend, campaign.previous.spend)} neutral />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="block">{formatInt(campaign.kpi.count)}</span>
        <span className="text-[11px] text-muted-foreground">{kpiUnit(campaign.kpi.count, campaign.kpi.label)}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="block">{formatMoney(campaign.current.spend > 0 ? campaign.kpi.cost : null)}</span>
        <Delta
          value={campaign.current.spend > 0 ? delta(campaign.kpi.cost, campaign.previousKpi.cost) : null}
          goodWhenUp={false}
        />
      </td>
      {hasRoas ? (
        <td className="px-3 py-2 text-right tabular-nums">
          <span className="block">{formatRoas(campaign.kpi.roas)}</span>
          <Delta value={delta(campaign.kpi.roas, campaign.previousKpi.roas)} />
        </td>
      ) : null}
      <td className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações em ${name}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Orçamento, pausar e ativar mudam na Meta — com prévia antes de confirmar
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("otimizar")}>
              <Wand2 className="size-3.5" /> Otimizar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("orcamento")}>
              <Wallet className="size-3.5" /> Alterar orçamento
            </DropdownMenuItem>
            {isActive ? (
              <DropdownMenuItem onSelect={() => onAction("pausar")}>
                <Pause className="size-3.5" /> Pausar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onAction("ativar")}>
                <Play className="size-3.5" /> Ativar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Criativos                                                         */
/* ------------------------------------------------------------------ */

function swapCandidate(ads: DossierAd[]): { adId: string; reason: string } | null {
  const running = ads.filter((ad) => ad.current.spend > 0);
  if (running.length < 2) return null;
  const totalSpend = running.reduce((sum, ad) => sum + ad.current.spend, 0);
  const totalCount = running.reduce((sum, ad) => sum + ad.kpi.count, 0);
  const average = totalCount > 0 ? totalSpend / totalCount : null;
  const heavy = running.filter((ad) => ad.spendShare >= 0.15);
  let worst: { ad: DossierAd; score: number } | null = null;
  for (const ad of heavy) {
    const score = ad.kpi.count === 0 ? Number.POSITIVE_INFINITY : ad.kpi.cost ?? 0;
    if (!worst || score > worst.score || (score === worst.score && ad.spendShare > worst.ad.spendShare)) {
      worst = { ad, score };
    }
  }
  if (!worst) return null;
  const share = `${Math.round(worst.ad.spendShare * 100)}% da verba`;
  if (worst.ad.kpi.count === 0) {
    return { adId: worst.ad.adId, reason: `Leva ${share} e não trouxe ${worst.ad.kpi.label.toLowerCase()}` };
  }
  if (average && worst.ad.kpi.cost && worst.ad.kpi.cost > average * 1.3) {
    const times = (worst.ad.kpi.cost / average).toFixed(1).replace(".", ",");
    return {
      adId: worst.ad.adId,
      reason: `Leva ${share} com ${worst.ad.kpi.costLabel} ${formatMoney(worst.ad.kpi.cost)} — ${times}× a média`,
    };
  }
  return null;
}

export function CreativesSection({ userId, days }: { userId: string; days: number }) {
  const { dialog, setDialog, close } = useMetaActionDialog();
  const [showAll, setShowAll] = useState(false);
  const query = useQuery<{ ads: DossierAd[] }>({
    queryKey: ["consultant-workspace-ads", userId, days],
    queryFn: async () => {
      const response = await fetch(`/api/consultant-workspace/ads?userId=${encodeURIComponent(userId)}&days=${days}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Falha ao ler os anúncios");
      return response.json();
    },
  });
  const ads = useMemo(() => query.data?.ads ?? [], [query.data]);
  const candidate = useMemo(() => swapCandidate(ads), [ads]);
  const ordered = useMemo(() => {
    if (!candidate) return ads;
    return [...ads].sort((a, b) => Number(b.adId === candidate.adId) - Number(a.adId === candidate.adId));
  }, [ads, candidate]);
  const list = showAll ? ordered : ordered.slice(0, 8);

  return (
    <Section
      title="Criativos"
      icon={ImageIcon}
      subtitle="Anúncios com gasto, do maior para o menor. Pausar muda na Meta (com prévia); trocar abre o Marketing do cliente."
    >
      {query.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <Empty title="Não consegui ler os anúncios">
          <button type="button" className="text-primary hover:underline" onClick={() => query.refetch()}>
            Tentar de novo
          </button>
        </Empty>
      ) : ads.length === 0 ? (
        <Empty title="Sem anúncios com gasto">Nenhum anúncio gastou neste período nem no anterior.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
            {list.map((ad) => (
              <AdCard
                key={ad.adId}
                ad={ad}
                candidateReason={candidate?.adId === ad.adId ? candidate.reason : null}
                onAction={(action) =>
                  setDialog({ entityId: ad.adId, entityName: entityDisplayName(ad.name, ad.adId, "Anúncio"), action })
                }
              />
            ))}
          </div>
          {ads.length > 8 ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAll ? "Mostrar menos" : `Ver todos os ${ads.length} anúncios`}
            </button>
          ) : null}
        </>
      )}
      {dialog ? (
        <MetaActionDialog
          key={`${dialog.entityId}-${dialog.action}`}
          open
          onOpenChange={(open) => (open ? null : close())}
          userId={userId}
          entityId={dialog.entityId}
          entityName={dialog.entityName}
          action={dialog.action}
        />
      ) : null}
    </Section>
  );
}

function AdThumb({ url, isVideo }: { url: string | null; isVideo: boolean }) {
  const [failed, setFailed] = useState(false);
  const Icon = isVideo ? Film : ImageIcon;
  if (!url || failed) {
    return (
      <div className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <Icon className="size-5" />
        <span className="text-[10px]">{isVideo ? "Vídeo" : "Imagem"} sem prévia</span>
      </div>
    );
  }
  return (
    <div className="relative h-28 w-full bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- prévia da Meta, pode expirar; sem otimização do Next */}
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      {isVideo ? (
        <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
          <Film className="size-3" /> vídeo
        </span>
      ) : null}
    </div>
  );
}

function AdCard({
  ad,
  candidateReason,
  onAction,
}: {
  ad: DossierAd;
  candidateReason: string | null;
  onAction: (action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const paused = ad.status === "PAUSED";
  const name = entityDisplayName(ad.name, ad.adId, "Anúncio");
  const campaignName = ad.campaignName ? humanizeName(ad.campaignName) : null;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
        candidateReason && "border-amber-400 ring-1 ring-amber-300/60 dark:border-amber-700 dark:ring-amber-800/60",
        paused && "opacity-70",
      )}
    >
      <div className="relative">
        <AdThumb url={ad.imageUrl} isVideo={ad.isVideo} />
        {candidateReason ? (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            <Repeat2 className="size-3" /> Candidato a trocar
          </span>
        ) : null}
        {paused ? (
          <span className="absolute top-1.5 right-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
            Pausado
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="min-w-0">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium" title={name}>
            {name}
          </p>
          {campaignName ? (
            <p className="truncate text-[11px] text-muted-foreground" title={campaignName}>
              {campaignName}
            </p>
          ) : null}
        </div>
        {candidateReason ? <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">{candidateReason}</p> : null}
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{Math.round(ad.spendShare * 100)}% do gasto</span>
            <span>{formatMoney(ad.current.spend, false)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, ad.spendShare * 100)}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
          <span>
            {formatInt(ad.kpi.count)} <span className="text-muted-foreground">{kpiUnit(ad.kpi.count, ad.kpi.label)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            {ad.kpi.cost != null ? (
              <>
                {formatMoney(ad.kpi.cost)}
                <Delta value={delta(ad.kpi.cost, ad.previousKpi.cost)} goodWhenUp={false} />
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">sem custo por resultado</span>
            )}
          </span>
        </div>
        <div className="mt-auto flex gap-1.5 pt-1">
          {paused ? (
            <Button size="xs" variant="outline" className="flex-1" onClick={() => onAction("ativar")}>
              <Play /> Ativar
            </Button>
          ) : (
            <Button size="xs" variant="outline" className="flex-1" onClick={() => onAction("pausar")}>
              <Pause /> Pausar
            </Button>
          )}
          <Button size="xs" variant={candidateReason ? "default" : "outline"} className="flex-1" onClick={() => onAction("trocar_criativo")}>
            <Repeat2 /> Trocar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Alertas resumidos                                                 */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function AlertsSummary({ userId, alerts, now }: { userId: string; alerts: WorkspaceAlert[]; now: number }) {
  const { store } = useWorkspaceState();
  const live = alerts.filter((alert) => isAlertLive(alert, store, now));
  const traffic = live.filter((alert) => !isOtherAreaAlert(alert));
  const other = live.filter(isOtherAreaAlert);
  const groups = (() => {
    const map = new Map<string, WorkspaceAlert[]>();
    for (const alert of traffic) {
      const list = map.get(alert.ruleTitle) ?? [];
      list.push(alert);
      map.set(alert.ruleTitle, list);
    }
    return [...map.entries()]
      .map(([title, items]) => ({
        title,
        items: [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.createdAt < b.createdAt ? 1 : -1)),
        worst: items.reduce<WorkspaceAlert["severity"]>(
          (worst, alert) => (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[worst] ? alert.severity : worst),
          "info",
        ),
        oldest: items.reduce((oldest, alert) => (alert.createdAt < oldest ? alert.createdAt : oldest), items[0].createdAt),
      }))
      .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.items.length - a.items.length);
  })();
  const otherTitles = [...new Set(other.map((alert) => alert.ruleTitle))];

  return (
    <Section
      title="Alertas resumidos"
      icon={CalendarClock}
      subtitle={
        traffic.length
          ? `${plural(traffic.length, "alerta aberto", "alertas abertos")} em ${plural(groups.length, "tipo", "tipos")}. Trate o tipo de uma vez — vai para o histórico.`
          : undefined
      }
    >
      {groups.length === 0 ? (
        <Empty title="Nenhum alerta de tráfego aberto">Nada pendente do playbook para este cliente.</Empty>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {groups.map((group) => (
            <AlertGroupRow key={group.title} userId={userId} group={group} />
          ))}
        </ul>
      )}
      {otherTitles.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Wallet className="size-3.5 shrink-0" />
          <span className="font-medium">Outras áreas (Financeiro/CS):</span>
          {otherTitles.join(" · ")}
          <span className="text-muted-foreground/70">— não é com você, só para saber antes de falar com o cliente.</span>
        </p>
      ) : null}
    </Section>
  );
}

function AlertGroupRow({
  userId,
  group,
}: {
  userId: string;
  group: { title: string; items: WorkspaceAlert[]; worst: WorkspaceAlert["severity"]; oldest: string };
}) {
  const { apply, isSaving } = useWorkspaceState();
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const ids = group.items.map((alert) => alert.id);
  const Icon = open ? ChevronDown : ChevronRight;

  async function snooze() {
    try {
      await apply({ op: "alertAction", insightIds: ids, userId, status: "snoozed", snoozeUntil: snoozeUntil(3) });
      toast.success(`${plural(ids.length, "alerta adiado", "alertas adiados")} por 3 dias`);
    } catch {
      // o erro já apareceu no aviso
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40"
      >
        <SeverityDot severity={group.worst} />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{group.title}</span>
          <span className="text-muted-foreground tabular-nums"> ×{group.items.length}</span>
          <span className="text-muted-foreground" suppressHydrationWarning>
            {" "}
            · {formatRelative(toIso(group.oldest))}
          </span>
        </span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
          <ul className="space-y-2">
            {group.items.slice(0, 8).map((alert) => (
              <li key={alert.id} className="space-y-0.5 text-xs">
                <p className="flex items-center gap-1.5">
                  <SeverityDot severity={alert.severity} />
                  <span className="font-medium">{alert.entityName ? `“${humanizeName(alert.entityName)}”` : alert.title}</span>
                  <span className="text-muted-foreground" suppressHydrationWarning>
                    · {formatRelative(toIso(alert.createdAt))}
                  </span>
                </p>
                {alert.evidence ? <p className="pl-3.5 text-muted-foreground">{humanize(alert.evidence)}</p> : null}
                {alert.recommendation ? (
                  <p className="pl-3.5">
                    <span className="font-medium">Sugestão: </span>
                    {humanize(alert.recommendation)}
                  </p>
                ) : null}
              </li>
            ))}
            {group.items.length > 8 ? (
              <li className="text-[11px] text-muted-foreground">e mais {group.items.length - 8} iguais…</li>
            ) : null}
          </ul>
          {resolving ? (
            <ResolveAlertForm userId={userId} insightIds={ids} compact onDone={() => setResolving(false)} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" onClick={() => setResolving(true)}>
                Tratar {ids.length > 1 ? `os ${ids.length}` : ""}
              </Button>
              <Button size="xs" variant="ghost" onClick={snooze} disabled={isSaving}>
                <CalendarClock /> Adiar 3 dias
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Mini-relatório para o cliente                                     */
/* ------------------------------------------------------------------ */

export function MiniReport({
  client,
  aiSentence,
  consultantName,
  onCompose,
}: {
  client: WorkspaceClient;
  aiSentence: string | null;
  consultantName: string | undefined;
  onCompose: () => void;
}) {
  const template = TEMPLATE_BY_KEY.get("resumo_semanal");
  const preview = template ? renderMessage(template, client, { consultantName, nextStep: aiSentence }) : "";
  return (
    <Section title="Mini-relatório para o cliente" icon={MessageSquareText}>
      <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-card px-3 py-3">
        <p className="min-w-0 flex-1 basis-80 text-sm leading-relaxed text-muted-foreground">
          <span className="line-clamp-3">{preview}</span>
          <span className="mt-1 block text-[11px]">
            {aiSentence
              ? "O próximo passo veio da análise da IA — revise antes de mandar."
              : "Gere a análise da IA para o próximo passo vir preenchido; sem ela, fica [o que você vai fazer] para completar."}
          </span>
        </p>
        <Button size="sm" onClick={onCompose}>
          <MessageSquareText className="size-3.5" /> Montar resumo
        </Button>
      </div>
    </Section>
  );
}
