"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type {
  MetaTrackingChangeSource,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";
import type {
  SerializedActionHistoryItem,
  TrackingHistoryResponse,
} from "@/lib/meta-tracking/action-history-view";

import { marketingKeys } from "../hooks/marketing-query-keys";

type ActionHistoryPanelProps = {
  accountId: string;
  userId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  /** Quando aberto num Sheet, evita buscar histórico de gaveta fechada. */
  enabled?: boolean;
};

const SOURCE_VARIANTS: Record<
  MetaTrackingChangeSource,
  "default" | "secondary" | "outline" | "destructive"
> = {
  backoffice_admin: "default",
  frontend_user: "secondary",
  external_detected: "outline",
  system: "outline",
};

function ActionCard({ action }: { action: SerializedActionHistoryItem }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {action.appliedToMeta ? (
            <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          ) : (
            <AlertCircle className="size-4 text-destructive shrink-0" />
          )}
          <span className="text-sm font-medium">
            {action.isExactTime ? "" : "Detectado em "}
            {formatDateTimeInSaoPaulo(
              action.isExactTime ? action.occurredAt : action.detectedAt,
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">{action.kindLabel}</Badge>
          <Badge variant={SOURCE_VARIANTS[action.source] ?? "outline"}>
            {action.sourceLabel}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {action.entityLevelLabel}
        {action.entityName ? `: ${action.entityName}` : ` ${action.entityId}`}
        {action.actorLabel ? ` · por ${action.actorLabel}` : ""}
      </p>

      {action.changes.length > 0 ? (
        <div className="space-y-1">
          {action.changes.map((change) => (
            <p key={change.field} className="text-sm break-words">
              <span className="font-medium">{change.label}:</span>{" "}
              <span className="text-muted-foreground">{change.from}</span>
              <ArrowRight className="inline size-3 mx-1 text-muted-foreground" />
              <span>{change.to}</span>
            </p>
          ))}
        </div>
      ) : null}

      {action.note ? (
        <div className="pt-2 border-t border-border">
          <p className="text-sm text-muted-foreground italic">
            &ldquo;{action.note}&rdquo;
          </p>
        </div>
      ) : null}

      {!action.appliedToMeta && action.failureMessage ? (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-destructive break-words">
            Não aplicado na Meta: {action.failureMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * O histórico unificado de ações de uma campanha ou conjunto: alterações feitas
 * pelo backoffice (com motivo), pelo painel do cliente e direto no Gerenciador
 * de Anúncios, na mesma linha do tempo.
 *
 * Lê o stream de `meta_tracking_change_events`, que é onde o motivo e o diff
 * campo a campo vivem — os edit logs legados só enxergam parte das ações.
 */
export function ActionHistoryPanel({
  accountId,
  userId,
  entityLevel,
  entityId,
  enabled = true,
}: ActionHistoryPanelProps) {
  const query = useQuery<TrackingHistoryResponse>({
    queryKey: marketingKeys.trackingHistory(
      accountId,
      userId,
      entityLevel,
      entityId,
    ),
    enabled: enabled && Boolean(accountId) && Boolean(userId) && Boolean(entityId),
    queryFn: async () => {
      const params = new URLSearchParams({ userId, entityLevel, entityId });
      const response = await fetch(
        `/api/meta-marketing/${accountId}/tracking-history?${params}`,
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar o histórico de ações");
      }
      return (await response.json()) as TrackingHistoryResponse;
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-3 w-56 mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <AlertCircle className="size-8 text-destructive mb-2" />
        <p className="text-sm text-destructive">
          {query.error instanceof Error
            ? query.error.message
            : "Erro ao carregar o histórico de ações"}
        </p>
      </div>
    );
  }

  const actions = query.data?.actions ?? [];

  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
        <History className="size-8 mb-2 opacity-50" />
        <p className="text-sm">Nenhuma ação registrada ainda</p>
        <p className="text-xs">
          Alterações feitas fora da plataforma aparecem aqui após a coleta
          diária.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
      {actions.map((action) => (
        <ActionCard key={action.id} action={action} />
      ))}
    </div>
  );
}
