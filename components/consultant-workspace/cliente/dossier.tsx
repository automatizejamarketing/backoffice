"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Film,
  ImageIcon,
  Loader2,
  Megaphone,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import type { AdPreview, AdPreviewFormat } from "@/lib/consultant-workspace/creative-previews";
import { ADS_MANAGER_HINT, adsManagerAdUrl, adsManagerCampaignUrl } from "@/lib/consultant-workspace/ads-manager";
import { OBJECTIVE_FAMILY_LABEL, objectiveFamily, type ObjectiveFamily } from "@/lib/consultant-workspace/objective";
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
import { useMarketingSheet } from "./marketing-sheet";
import { humanize, humanizeName } from "@/components/consultant-workspace/common/signal-helpers";
import {
  CAMPAIGN_STATUS_LABEL,
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

/** Anúncios do período (banco). Mesma chave no relatório e nos criativos: uma leitura só. */
function useDossierAds(userId: string, days: number) {
  return useQuery<{ ads: DossierAd[] }>({
    queryKey: ["consultant-workspace-ads", userId, days],
    queryFn: async () => {
      const response = await fetch(`/api/consultant-workspace/ads?userId=${encodeURIComponent(userId)}&days=${days}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Falha ao ler os anúncios");
      return response.json();
    },
  });
}

/** Miniaturas e texto ao vivo da Meta; chegam depois da lista. */
function useAdPreviews(userId: string, ads: DossierAd[]) {
  const adIds = useMemo(() => ads.map((ad) => ad.adId).sort(), [ads]);
  return useQuery<{ previews: Record<string, AdPreview>; error?: string }>({
    queryKey: ["consultant-workspace-ad-previews", userId, adIds],
    enabled: adIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(
        `/api/consultant-workspace/ads/previews?userId=${encodeURIComponent(userId)}&ids=${adIds.join(",")}`,
      );
      if (!response.ok) throw new Error("Falha ao ler as prévias");
      return response.json();
    },
  });
}

const OBJECTIVE_TONE: Record<ObjectiveFamily, string> = {
  vendas: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  trafego: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  cadastros: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  mensagens: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  reconhecimento: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  app: "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  outro: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

function ObjectiveBadge({ objective }: { objective: string | null }) {
  const family = objectiveFamily(objective);
  if (!family) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10px] leading-4 font-semibold", OBJECTIVE_TONE[family])}
      title={objective ?? undefined}
    >
      {OBJECTIVE_FAMILY_LABEL[family]}
    </span>
  );
}

export function CampaignReport({ detail, range }: { detail: WorkspaceClientDetail; range: WorkspaceRange }) {
  const { dialog, setDialog, close } = useMetaActionDialog();
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opened, setOpened] = useState<DossierAd | null>(null);
  const campaigns = detail.campaigns;
  const { client } = detail;
  const adsQuery = useDossierAds(client.userId, range.days);
  const ads = useMemo(() => adsQuery.data?.ads ?? [], [adsQuery.data]);
  const previews = useAdPreviews(client.userId, ads);
  const openAdAction = (ad: DossierAd, action: WorkspaceSimulatedAction["action"]) =>
    setDialog({ entityId: ad.adId, entityName: entityDisplayName(ad.name, ad.adId, "Anúncio"), action });
  const hasRoas = campaigns.some((campaign) => campaign.kpi.roas != null) || client.perf.kpi.roas != null;
  const list = showAll ? campaigns : campaigns.slice(0, 8);

  return (
    <Section
      title="Relatório padrão"
      icon={MessageSquareText}
      subtitle={`Campanhas de ${formatDay(range.from)} a ${formatDay(range.to)} contra ${formatDay(range.prevFrom)} a ${formatDay(range.prevTo)} · clique na campanha para ver conjuntos e anúncios`}
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
                <Fragment key={campaign.campaignId}>
                  <CampaignRow
                    campaign={campaign}
                    hasRoas={hasRoas}
                    expanded={expanded === campaign.campaignId}
                    onToggle={() => setExpanded((current) => (current === campaign.campaignId ? null : campaign.campaignId))}
                    onAction={(action) =>
                      setDialog({
                        entityId: campaign.campaignId,
                        entityName: entityDisplayName(campaign.name, campaign.campaignId, "Campanha"),
                        action,
                        budget: campaign.dailyBudget,
                      })
                    }
                  />
                  {expanded === campaign.campaignId ? (
                    <tr className="bg-muted/20">
                      <td colSpan={hasRoas ? 6 : 5} className="px-3 py-2.5">
                        <CampaignAds
                          campaign={campaign}
                          ads={ads.filter((ad) => ad.campaignId === campaign.campaignId)}
                          loading={adsQuery.isLoading}
                          previews={previews.data?.previews ?? {}}
                          previewsLoading={previews.isLoading}
                          onOpen={setOpened}
                          onAction={openAdAction}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
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
      {opened ? (
        <AdPreviewDialog
          userId={client.userId}
          ad={opened}
          preview={previews.data?.previews[opened.adId] ?? null}
          onClose={() => setOpened(null)}
          onAction={(action) => {
            setOpened(null);
            openAdAction(opened, action);
          }}
        />
      ) : null}
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
  expanded,
  onToggle,
  onAction,
}: {
  campaign: WorkspaceCampaign;
  hasRoas: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const marketing = useMarketingSheet();
  const managerHref = adsManagerCampaignUrl(campaign.accountId, campaign.campaignId);
  const rawStatus = campaign.effectiveStatus ?? campaign.status ?? "";
  const status = CAMPAIGN_STATUS_LABEL[rawStatus] ?? (rawStatus ? "Outro status" : "—");
  const name = entityDisplayName(campaign.name, campaign.campaignId, "Campanha");
  const isActive = rawStatus === "ACTIVE";
  const budget = campaign.dailyBudget
    ? `${formatMoney(campaign.dailyBudget, false)}/dia`
    : campaign.lifetimeBudget
      ? `${formatMoney(campaign.lifetimeBudget, false)} total`
      : null;
  return (
    <tr className={cn("align-top", expanded && "bg-muted/20")}>
      <td className="max-w-[360px] px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full min-w-0 items-start gap-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <ObjectiveBadge objective={campaign.objective} />
              <span className="truncate font-medium hover:underline" title={name}>
                {name}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-zinc-400")} />
              {status}
              {budget ? <span>· {budget}</span> : null}
            </span>
          </span>
        </button>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggle}>
              <ChevronDown className="size-3.5" /> {expanded ? "Esconder anúncios" : "Ver conjuntos e anúncios"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={marketing.open}>
              <Megaphone className="size-3.5" /> Ver no Marketing do cliente
            </DropdownMenuItem>
            {managerHref ? (
              <DropdownMenuItem asChild title={ADS_MANAGER_HINT}>
                <a href={managerHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" /> Abrir no Gerenciador
                </a>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/** Conjuntos e anúncios de uma campanha, dentro da tabela. */
function CampaignAds({
  campaign,
  ads,
  loading,
  previews,
  previewsLoading,
  onOpen,
  onAction,
}: {
  campaign: WorkspaceCampaign;
  ads: DossierAd[];
  loading: boolean;
  previews: Record<string, AdPreview>;
  previewsLoading: boolean;
  onOpen: (ad: DossierAd) => void;
  onAction: (ad: DossierAd, action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const marketing = useMarketingSheet();
  const managerHref = adsManagerCampaignUrl(campaign.accountId, campaign.campaignId);
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; ads: DossierAd[]; spend: number }>();
    for (const ad of ads) {
      const key = ad.adsetId ?? "sem-conjunto";
      const group = map.get(key) ?? { name: ad.adsetName ? humanizeName(ad.adsetName) : "Conjunto sem nome", ads: [], spend: 0 };
      group.ads.push(ad);
      group.spend += ad.current.spend;
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [ads]);

  return (
    <div className="space-y-2.5">
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum anúncio desta campanha gastou neste período nem no anterior.</p>
      ) : (
        groups.map((group) => (
          <div key={group.name + group.ads[0].adId} className="space-y-1">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Conjunto · {group.name} <span className="font-normal normal-case">· {formatMoney(group.spend, false)}</span>
            </p>
            <div className="divide-y rounded-lg border bg-card">
              {group.ads.map((ad) => (
                <CampaignAdLine
                  key={ad.adId}
                  ad={ad}
                  preview={previews[ad.adId] ?? null}
                  previewLoading={previewsLoading}
                  onOpen={() => onOpen(ad)}
                  onAction={(action) => onAction(ad, action)}
                />
              ))}
            </div>
          </div>
        ))
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={marketing.open}>
          <Megaphone /> Ver no Marketing do cliente
        </Button>
        {managerHref ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button size="xs" variant="outline" asChild>
                <a href={managerHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Abrir campanha no Gerenciador
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-60 text-xs">{ADS_MANAGER_HINT}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function CampaignAdLine({
  ad,
  preview,
  previewLoading,
  onOpen,
  onAction,
}: {
  ad: DossierAd;
  preview: AdPreview | null;
  previewLoading: boolean;
  onOpen: () => void;
  onAction: (action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const name = entityDisplayName(ad.name, ad.adId, "Anúncio");
  const paused = ad.status === "PAUSED";
  return (
    <div className={cn("flex items-center gap-2.5 px-2 py-1.5", paused && "opacity-70")}>
      <button type="button" onClick={onOpen} className="w-16 shrink-0 overflow-hidden rounded" aria-label={`Ver o anúncio ${name}`}>
        <AdThumb
          urls={[preview?.thumbnailUrl, preview?.imageUrl, ad.imageUrl]}
          isVideo={preview ? Boolean(preview.videoId) : ad.isVideo}
          loading={previewLoading}
          compact
        />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-[13px] font-medium hover:underline" title={name}>
          {name}
        </button>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {paused ? "Pausado · " : ""}
          {formatMoney(ad.current.spend, false)} · {formatInt(ad.kpi.count)} {kpiUnit(ad.kpi.count, ad.kpi.label)}
          {ad.kpi.cost != null ? ` · ${formatMoney(ad.kpi.cost)} cada` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => onAction(paused ? "ativar" : "pausar")}>
          {paused ? <Play /> : <Pause />} {paused ? "Ativar" : "Pausar"}
        </Button>
        <AdsManagerLink ad={ad} />
      </div>
    </div>
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
  const [opened, setOpened] = useState<DossierAd | null>(null);
  const query = useDossierAds(userId, days);
  const ads = useMemo(() => query.data?.ads ?? [], [query.data]);
  // A lista vem do banco; as miniaturas chegam depois, ao vivo da Meta.
  const previewsQuery = useAdPreviews(userId, ads);
  const previews = previewsQuery.data?.previews ?? {};
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
      subtitle="Anúncios com gasto, do maior para o menor. Clique na imagem para ver o anúncio. Pausar muda na Meta (com prévia); trocar abre o Marketing do cliente."
      right={
        previewsQuery.data?.error ? (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">{previewsQuery.data.error}</span>
        ) : undefined
      }
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
                preview={previews[ad.adId] ?? null}
                previewLoading={previewsQuery.isLoading}
                candidateReason={candidate?.adId === ad.adId ? candidate.reason : null}
                onOpen={() => setOpened(ad)}
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
      {opened ? (
        <AdPreviewDialog
          userId={userId}
          ad={opened}
          preview={previews[opened.adId] ?? null}
          onClose={() => setOpened(null)}
          onAction={(action) => {
            setOpened(null);
            setDialog({ entityId: opened.adId, entityName: entityDisplayName(opened.name, opened.adId, "Anúncio"), action });
          }}
        />
      ) : null}
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

/** Tenta as URLs em ordem (ao vivo primeiro; a guardada no banco costuma ter expirado). */
function AdThumb({
  urls,
  isVideo,
  loading,
  compact = false,
}: {
  urls: Array<string | null | undefined>;
  isVideo: boolean;
  loading: boolean;
  compact?: boolean;
}) {
  const candidates = urls.filter((url): url is string => Boolean(url));
  const key = candidates.join("|");
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const failedCount = failed.key === key ? failed.count : 0;
  const url = candidates[failedCount] ?? null;
  const Icon = isVideo ? Film : ImageIcon;
  const height = compact ? "h-12" : "h-28";
  if (loading) return <Skeleton className={cn(height, "w-full rounded-none")} />;
  if (!url) {
    return (
      <div className={cn(height, "flex w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground")}>
        <Icon className="size-5" />
        {compact ? null : <span className="text-[10px]">{isVideo ? "Vídeo" : "Imagem"} sem prévia</span>}
      </div>
    );
  }
  return (
    <div className={cn(height, "relative w-full bg-muted")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- prévia da Meta, pode expirar; sem otimização do Next */}
      <img
        key={url}
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFailed({ key, count: failedCount + 1 })}
      />
      {isVideo ? (
        <span className="absolute right-1 bottom-1 inline-flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
          <Film className="size-3" /> {compact ? null : "vídeo"}
        </span>
      ) : null}
    </div>
  );
}

function AdsManagerLink({ ad, label }: { ad: DossierAd; label?: string }) {
  const href = adsManagerAdUrl(ad.accountId, ad.adId);
  if (!href) return null;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button size={label ? "sm" : "icon-xs"} variant="outline" asChild>
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Abrir no Gerenciador de Anúncios">
            <ExternalLink />
            {label}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 text-xs">{ADS_MANAGER_HINT}</TooltipContent>
    </Tooltip>
  );
}

function AdCard({
  ad,
  preview,
  previewLoading,
  candidateReason,
  onOpen,
  onAction,
}: {
  ad: DossierAd;
  preview: AdPreview | null;
  previewLoading: boolean;
  candidateReason: string | null;
  onOpen: () => void;
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
      <button type="button" className="relative block text-left" onClick={onOpen} aria-label={`Ver o anúncio ${name}`}>
        <AdThumb
          urls={[preview?.thumbnailUrl, preview?.imageUrl, ad.imageUrl]}
          isVideo={preview ? Boolean(preview.videoId) : ad.isVideo}
          loading={previewLoading}
        />
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
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="line-clamp-2 text-left text-[13px] leading-snug font-medium hover:underline"
            title={name}
          >
            {name}
          </button>
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
          <AdsManagerLink ad={ad} />
        </div>
      </div>
    </div>
  );
}

const CTA_LABEL: Record<string, string> = {
  ORDER_NOW: "Pedir agora",
  SHOP_NOW: "Comprar agora",
  LEARN_MORE: "Saiba mais",
  SIGN_UP: "Cadastre-se",
  SUBSCRIBE: "Assinar",
  GET_OFFER: "Ver oferta",
  CONTACT_US: "Fale conosco",
  BOOK_TRAVEL: "Reservar",
  DOWNLOAD: "Baixar",
  SEND_MESSAGE: "Enviar mensagem",
  MESSAGE_PAGE: "Enviar mensagem",
  WHATSAPP_MESSAGE: "Enviar mensagem no WhatsApp",
  CALL_NOW: "Ligar agora",
  GET_QUOTE: "Pedir orçamento",
  APPLY_NOW: "Inscreva-se",
};

const PREVIEW_FORMATS: Array<{ value: AdPreviewFormat; label: string }> = [
  { value: "MOBILE_FEED_STANDARD", label: "Feed Facebook" },
  { value: "INSTAGRAM_STANDARD", label: "Feed Instagram" },
  { value: "INSTAGRAM_STORY", label: "Stories" },
];

function AdPreviewDialog({
  userId,
  ad,
  preview,
  onClose,
  onAction,
}: {
  userId: string;
  ad: DossierAd;
  preview: AdPreview | null;
  onClose: () => void;
  onAction: (action: WorkspaceSimulatedAction["action"]) => void;
}) {
  const [format, setFormat] = useState<AdPreviewFormat>("MOBILE_FEED_STANDARD");
  const frame = useQuery<{ src: string | null; error?: string }>({
    queryKey: ["consultant-workspace-ad-frame", userId, ad.adId, format],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(
        `/api/consultant-workspace/ads/preview-frame?userId=${encodeURIComponent(userId)}&adId=${ad.adId}&format=${format}`,
      );
      if (!response.ok) throw new Error("Falha ao gerar a prévia");
      return response.json();
    },
  });
  const name = entityDisplayName(ad.name, ad.adId, "Anúncio");
  const paused = ad.status === "PAUSED";
  const story = format === "INSTAGRAM_STORY";
  const fallback = preview?.imageUrl ?? preview?.thumbnailUrl ?? ad.imageUrl;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-base leading-snug">{name}</DialogTitle>
          <DialogDescription className="text-xs">
            {[ad.campaignName ? humanizeName(ad.campaignName) : null, ad.adsetName ? humanizeName(ad.adsetName) : null]
              .filter(Boolean)
              .join(" · ") || "Anúncio"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="tablist" aria-label="Formato da prévia">
              {PREVIEW_FORMATS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={option.value === format}
                  onClick={() => setFormat(option.value)}
                  className={cn(
                    "rounded-[5px] px-2 py-0.5 text-[11px] transition-colors",
                    option.value === format ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={cn("overflow-hidden rounded-lg border bg-muted", story ? "h-[620px]" : "h-[520px]")}>
              {frame.isLoading ? (
                <Skeleton className="h-full w-full rounded-none" />
              ) : frame.data?.src ? (
                <iframe
                  key={frame.data.src}
                  src={frame.data.src}
                  title={`Prévia do anúncio ${name}`}
                  className="h-full w-full border-0 bg-white"
                  allow="autoplay; encrypted-media"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                  {fallback ? (
                    // eslint-disable-next-line @next/next/no-img-element -- prévia da Meta, sem otimização do Next
                    <img src={fallback} alt="" referrerPolicy="no-referrer" className="max-h-[400px] w-full rounded object-contain" />
                  ) : (
                    <ImageIcon className="size-6" />
                  )}
                  <span>{frame.data?.error ?? "A Meta não gerou a prévia neste formato."}</span>
                </div>
              )}
            </div>
            {frame.data?.src ? (
              <a
                href={frame.data.src}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Prévia em branco? Abrir em nova aba <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          <div className="min-w-0 space-y-3 text-sm">
            {preview?.title ? <p className="font-medium">{preview.title}</p> : null}
            {preview?.body ? (
              <p className="max-h-56 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-line text-muted-foreground">{preview.body}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Sem texto do anúncio disponível.</p>
            )}
            {preview?.link ? (
              <p className="truncate text-xs">
                <span className="text-muted-foreground">Destino </span>
                <a href={preview.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {preview.link}
                </a>
              </p>
            ) : null}
            {preview?.callToAction ? (
              <p className="text-xs text-muted-foreground">
                Botão: {CTA_LABEL[preview.callToAction] ?? preview.callToAction.toLowerCase().replace(/_/g, " ")}
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card px-3 py-2 text-xs tabular-nums">
              <div>
                <p className="text-muted-foreground">Investido</p>
                <p className="font-medium">{formatMoney(ad.current.spend, false)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ad.kpi.label}</p>
                <p className="font-medium">{formatInt(ad.kpi.count)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ad.kpi.costLabel}</p>
                <p className="font-medium">{formatMoney(ad.kpi.cost)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {paused ? (
                <Button size="sm" variant="outline" onClick={() => onAction("ativar")}>
                  <Play className="size-3.5" /> Ativar
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAction("pausar")}>
                  <Pause className="size-3.5" /> Pausar
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onAction("trocar_criativo")}>
                <Repeat2 className="size-3.5" /> Trocar criativo
              </Button>
              <AdsManagerLink ad={ad} label="Abrir no Gerenciador" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
