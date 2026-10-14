"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CircleCheck, ExternalLink, Lightbulb, Loader2, Pause, RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import type { OfferSuggestion } from "@/lib/consultant-workspace/offer-suggestion";
import { MAT_TEMPLATE_PREFIX } from "@/lib/consultant-workspace/outreach-core";
import {
  firstNameOf,
  offerMessage,
  SITUATION_LABEL,
  type LiveCheckStatus,
  type MatDraft,
  type SuggestedAction,
  type SuggestionAction,
} from "@/lib/consultant-workspace/playbook-actions";
import { SeverityDot } from "./primitives";
import { MetaActionDialog } from "./actions";
import { OfferSuggestionDialog } from "./offer-dialog";
import { OutreachDialog } from "./outreach-dialog";
import { useWorkspaceState } from "./use-workspace-state";

export const SUGGESTED_ACTIONS_KEY = "consultant-workspace-suggested-actions";

type DbResponse = { suggestions: SuggestedAction[]; days: number };
type LiveResponse = { suggestions: SuggestedAction[]; checks: LiveCheckStatus[] };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Falha ao carregar as ações sugeridas");
  return body;
}

/** Escalar e criativo ruim: só banco, barato — serve a Fila e a página do cliente. */
export function useSuggestedActions(userId: string, days: number, enabled = true) {
  return useQuery<DbResponse>({
    queryKey: [SUGGESTED_ACTIONS_KEY, "db", userId, days],
    queryFn: () => getJson(`/api/consultant-workspace/suggested-actions?userId=${encodeURIComponent(userId)}&days=${days}`),
    staleTime: 60_000,
    enabled,
  });
}

/** O valor depois de parar de mudar por `ms` (a Fila troca de cliente a cada tecla). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Pixel e saldo ao vivo na Meta: só na página do cliente (nunca em lista). */
function useLiveChecks(userId: string, days: number) {
  const queryClient = useQueryClient();
  const key = [SUGGESTED_ACTIONS_KEY, "live", userId, days];
  const query = useQuery<LiveResponse>({
    queryKey: key,
    queryFn: () => getJson(`/api/consultant-workspace/suggested-actions?userId=${encodeURIComponent(userId)}&days=${days}&live=1`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  async function checkNow() {
    setRefreshing(true);
    try {
      const fresh = await getJson<LiveResponse>(
        `/api/consultant-workspace/suggested-actions?userId=${encodeURIComponent(userId)}&days=${days}&live=1&fresh=1`,
      );
      queryClient.setQueryData(key, fresh);
    } catch {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }
  return { ...query, checkNow, refreshing };
}

type Target = { userId: string; clientName: string; clientFullName: string | null; days: number };

/**
 * Os diálogos que os botões abrem: Meta (pausar com prévia ao vivo), Mat
 * (prévia do app → confirmar) e oferta/combo da IA (→ Mat preenchida).
 */
function useSuggestionDialogs(target: Target) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { store } = useWorkspaceState();
  const [pause, setPause] = useState<{ entityId: string; entityName: string | null; note: string } | null>(null);
  const [mat, setMat] = useState<MatDraft | null>(null);
  const [offer, setOffer] = useState<{ adIds: string[]; entity?: MatDraft["entity"] } | null>(null);

  const lastMatSent = useMemo(() => {
    const map = new Map<string, string>();
    for (const message of store.sentMessages) {
      if (message.userId !== target.userId || message.channel !== "mat") continue;
      const kind = message.templateKey.slice(MAT_TEMPLATE_PREFIX.length);
      if (!map.has(kind) || map.get(kind)! < message.at) map.set(kind, message.at);
    }
    return map;
  }, [store.sentMessages, target.userId]);

  function run(action: SuggestionAction) {
    if (action.type === "meta_pause") setPause({ entityId: action.entityId, entityName: action.entityName, note: action.note });
    else if (action.type === "mat") setMat(action.draft);
    else if (action.type === "offer_ai") setOffer({ adIds: action.adIds, entity: action.entity });
  }

  function pickOffer(choice: OfferSuggestion) {
    const entity = offer?.entity;
    setOffer(null);
    setMat({ ...offerMessage({ firstName: firstNameOf(target.clientFullName) }, choice), ...(entity ? { entity } : {}) });
  }

  const dialogs = (
    <>
      {pause ? (
        <MetaActionDialog
          key={pause.entityId}
          open
          onOpenChange={(open) => {
            if (open) return;
            setPause(null);
            router.refresh();
            void queryClient.invalidateQueries({ queryKey: [SUGGESTED_ACTIONS_KEY] });
          }}
          userId={target.userId}
          entityId={pause.entityId}
          entityName={pause.entityName}
          action="pausar"
          defaultNote={pause.note}
        />
      ) : null}
      <OfferSuggestionDialog
        open={offer != null}
        onOpenChange={(open) => (open ? null : setOffer(null))}
        userId={target.userId}
        adIds={offer?.adIds ?? []}
        days={target.days}
        onPick={pickOffer}
      />
      <OutreachDialog
        open={mat != null}
        onOpenChange={(open) => (open ? null : setMat(null))}
        userId={target.userId}
        clientName={target.clientName}
        draft={mat}
        lastMatSentAt={mat ? (lastMatSent.get(mat.kind) ?? null) : null}
      />
    </>
  );
  return { run, dialogs, lastMatSent };
}

const SEVERITY_TONE: Record<SuggestedAction["severity"], string> = {
  critical: "border-red-300/80 dark:border-red-900",
  warning: "border-amber-300/80 dark:border-amber-900",
  info: "border-emerald-300/80 dark:border-emerald-900",
};

function ActionButton({ action, onRun, size, primary }: { action: SuggestionAction; onRun: () => void; size: "xs" | "sm"; primary: boolean }) {
  if (action.type === "link") {
    return (
      <Button size={size} variant="ghost" asChild>
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          <ExternalLink /> {action.label}
        </a>
      </Button>
    );
  }
  const Icon = action.type === "meta_pause" ? Pause : action.type === "mat" ? Bot : Lightbulb;
  return (
    <Button
      size={size}
      variant={primary ? "default" : "outline"}
      onClick={onRun}
      title={action.type === "mat" ? "Mandar pela Mat (WhatsApp da Automatize)" : action.type === "meta_pause" ? "Pausa na Meta, com prévia do estado atual antes de confirmar" : undefined}
    >
      <Icon /> {action.label}
      {action.type === "mat" ? <span className="font-normal opacity-80">pela Mat</span> : null}
    </Button>
  );
}

function SuggestionCard({
  suggestion,
  onRun,
  lastMatSentAt,
  compact,
  recheck,
}: {
  suggestion: SuggestedAction;
  onRun: (action: SuggestionAction) => void;
  lastMatSentAt: string | null;
  compact?: boolean;
  /** Pixel e saldo: reler na Meta (depois que o cliente resolveu, por exemplo). */
  recheck?: { run: () => void; busy: boolean };
}) {
  return (
    <li className={cn("space-y-1.5 rounded-lg border-l-4 border bg-card", SEVERITY_TONE[suggestion.severity], compact ? "px-2.5 py-2" : "px-3 py-2.5")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <SeverityDot severity={suggestion.severity} />
        <span className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{SITUATION_LABEL[suggestion.situation]}</span>
        <p className={cn("min-w-0 font-medium", compact ? "text-[13px]" : "text-sm")}>{suggestion.title}</p>
      </div>
      <p className={cn("text-muted-foreground", compact ? "text-[11.5px] leading-snug" : "text-xs leading-relaxed")}>{suggestion.why}</p>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {suggestion.actions.map((action, index) => (
          <ActionButton key={`${action.type}-${index}`} action={action} size={compact ? "xs" : "sm"} primary={index === 0} onRun={() => onRun(action)} />
        ))}
        {recheck ? (
          <Button size={compact ? "xs" : "sm"} variant="ghost" onClick={recheck.run} disabled={recheck.busy}>
            {recheck.busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Checar agora
          </Button>
        ) : null}
      </div>
      {lastMatSentAt ? (
        <p className="text-[11px] text-muted-foreground">
          <Bot className="mr-1 inline size-3" />A Mat já mandou uma mensagem deste tipo {formatRelative(lastMatSentAt)}.
        </p>
      ) : null}
    </li>
  );
}

function matKindOf(suggestion: SuggestedAction) {
  const mat = suggestion.actions.find((action) => action.type === "mat");
  return mat?.type === "mat" ? mat.draft.kind : null;
}

function LiveChecksLine({
  checks,
  loading,
  refreshing,
  error,
  onCheckNow,
}: {
  checks: LiveCheckStatus[];
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  onCheckNow: () => void;
}) {
  const checkedAt = checks.map((check) => check.checkedAt).filter(Boolean).sort()[0] ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs">
      <span className="font-medium text-muted-foreground">Na Meta agora:</span>
      {loading ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> checando pixel e saldo…
        </span>
      ) : error ? (
        <span className="text-amber-700 dark:text-amber-400">não consegui checar agora</span>
      ) : checks.length === 0 ? (
        <span className="text-muted-foreground">nada para checar</span>
      ) : (
        checks.map((check) => (
          <span
            key={`${check.check}-${check.adAccountId}`}
            className={cn(
              "inline-flex items-center gap-1",
              check.status === "ok" && "text-emerald-700 dark:text-emerald-400",
              check.status === "problem" && "text-red-700 dark:text-red-400",
              (check.status === "error" || check.status === "unknown") && "text-amber-700 dark:text-amber-400",
            )}
            title={check.adAccountId ?? undefined}
          >
            {check.status === "ok" ? <CircleCheck className="size-3" /> : <TriangleAlert className="size-3" />}
            {check.summary}
          </span>
        ))
      )}
      <span className="ml-auto inline-flex items-center gap-2">
        {checkedAt && !loading ? <span className="text-muted-foreground">checado {formatRelative(checkedAt)}</span> : null}
        <Button size="xs" variant="outline" onClick={onCheckNow} disabled={loading || refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Checar agora
        </Button>
      </span>
    </div>
  );
}

/**
 * "Ações sugeridas" no topo da página do cliente: escalar e criativo ruim
 * (banco) + pixel e saldo (ao vivo, rodam ao abrir a página, com cache de 5 min).
 */
export function SuggestedActionsSection({
  userId,
  clientName,
  clientFullName,
  days,
}: {
  userId: string;
  clientName: string;
  clientFullName: string | null;
  days: number;
}) {
  const db = useSuggestedActions(userId, days);
  const live = useLiveChecks(userId, days);
  const { run, dialogs, lastMatSent } = useSuggestionDialogs({ userId, clientName, clientFullName, days });
  const suggestions = useMemo(() => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...(live.data?.suggestions ?? []), ...(db.data?.suggestions ?? [])].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [db.data, live.data]);

  return (
    <section className="space-y-2.5 rounded-xl border border-violet-200 bg-violet-50/30 p-3 dark:border-violet-900/70 dark:bg-violet-950/10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Zap className="size-4 text-violet-600 dark:text-violet-400" /> Ações sugeridas
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pelo playbook, com os números de {days} dias. Um clique pausa na Meta (com prévia) ou pede à Mat para falar com o cliente.
          </p>
        </div>
      </div>
      <LiveChecksLine
        checks={live.data?.checks ?? []}
        loading={live.isLoading}
        refreshing={live.refreshing}
        error={live.isError}
        onCheckNow={live.checkNow}
      />
      {db.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : db.isError ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Não consegui montar as ações sugeridas.{" "}
          <button type="button" className="underline" onClick={() => db.refetch()}>
            Tentar de novo
          </button>
        </p>
      ) : suggestions.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">
          Nenhuma ação sugerida agora: nada validou para escalar e nenhum criativo está queimando verba.
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((suggestion) => {
            const kind = matKindOf(suggestion);
            return (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onRun={run}
                lastMatSentAt={kind ? (lastMatSent.get(kind) ?? null) : null}
                recheck={
                  suggestion.situation === "pixel" || suggestion.situation === "balance"
                    ? { run: live.checkNow, busy: live.refreshing || live.isFetching }
                    : undefined
                }
              />
            );
          })}
        </ul>
      )}
      {dialogs}
    </section>
  );
}

/** Bloco compacto da Fila: só o que sai do banco (escalar, criativo ruim) — sem chamada à Meta. */
export function SuggestedActionsCompact({
  userId,
  clientName,
  clientFullName,
  days,
}: {
  userId: string;
  clientName: string;
  clientFullName: string | null;
  days: number;
}) {
  // Só busca quando a seleção para: navegar a Fila no teclado não vira uma rajada no banco.
  const settledUserId = useSettled(userId, 350);
  const settled = settledUserId === userId;
  const db = useSuggestedActions(userId, days, settled);
  const { run, dialogs, lastMatSent } = useSuggestionDialogs({ userId, clientName, clientFullName, days });
  const loading = !settled || db.isLoading;
  const suggestions = db.data?.suggestions ?? [];
  if (!loading && !db.isError && suggestions.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Zap className="size-3" /> Ações sugeridas
      </h3>
      {loading ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : db.isError ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">Não consegui montar as ações sugeridas.</p>
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((suggestion) => {
            const kind = matKindOf(suggestion);
            return (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onRun={run}
                lastMatSentAt={kind ? (lastMatSent.get(kind) ?? null) : null}
                compact
              />
            );
          })}
        </ul>
      )}
      {dialogs}
    </section>
  );
}
