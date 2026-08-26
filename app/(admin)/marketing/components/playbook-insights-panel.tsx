"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listPlaybookApplyActions,
  type PlaybookApplyActionDef,
} from "@/lib/playbook-insights/actions";
import {
  type PlaybookInsightRow,
  useApplyPlaybookInsight,
  usePlaybookInsights,
  useUpdatePlaybookInsightStatus,
} from "../hooks/use-playbook-insights";

function severityBadgeClass(severity: PlaybookInsightRow["severity"]) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "";
}

function severityLabel(severity: PlaybookInsightRow["severity"]) {
  if (severity === "critical") return "Crítico";
  if (severity === "warning") return "Atenção";
  return "Info";
}

type PendingApply = {
  insight: PlaybookInsightRow;
  action: PlaybookApplyActionDef;
};

type PlaybookInsightsPanelProps = {
  userId: string;
  accountId?: string | null;
};

export function PlaybookInsightsPanel({
  userId,
  accountId,
}: PlaybookInsightsPanelProps) {
  const query = usePlaybookInsights(userId);
  const updateStatus = useUpdatePlaybookInsightStatus(userId);
  const applyAction = useApplyPlaybookInsight(userId, accountId);
  const insights = query.data ?? [];
  const [pending, setPending] = useState<PendingApply | null>(null);
  const busy = updateStatus.isPending || applyAction.isPending;

  const runApply = () => {
    if (!pending) return;
    const { insight, action } = pending;
    applyAction.mutate(
      { insightId: insight.id, action: action.id },
      {
        onSuccess: (result) => {
          toast.success(result.summary);
          setPending(null);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Falha ao aplicar a sugestão na Meta",
          );
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Sugestões do playbook
        </h3>
        {insights.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {insights.length === 1
              ? "1 aberta"
              : `${insights.length} abertas`}
          </Badge>
        )}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Carregando sugestões...
        </p>
      ) : query.isError ? (
        <p className="text-sm text-red-600">
          {query.error instanceof Error
            ? query.error.message
            : "Falha ao carregar sugestões"}
        </p>
      ) : insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma sugestão aberta para este cliente.
        </p>
      ) : (
        <ul className="space-y-3">
          {insights.map((insight) => {
            const actions = listPlaybookApplyActions(insight);
            return (
              <li key={insight.id}>
                <Card className="border-border/80 shadow-none">
                  <CardHeader className="space-y-2 p-4 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${severityBadgeClass(insight.severity)}`}
                      >
                        {severityLabel(insight.severity)}
                      </Badge>
                      <CardTitle className="text-sm font-medium">
                        {insight.title}
                      </CardTitle>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {insight.entityName}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    <p className="text-sm text-foreground">{insight.evidence}</p>
                    <p className="text-sm text-muted-foreground">
                      {insight.recommendation}
                    </p>
                    {actions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Diagnóstico — não há alteração automática na Meta.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {actions.map((action) => (
                        <Button
                          key={action.id}
                          type="button"
                          size="sm"
                          variant={action.variant}
                          disabled={busy}
                          onClick={() => setPending({ insight, action })}
                        >
                          {action.label}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          updateStatus.mutate({
                            insightId: insight.id,
                            status: "done",
                            reviewNote: "Tratado fora do botão de aplicar",
                          })
                        }
                      >
                        Já tratei
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          updateStatus.mutate({
                            insightId: insight.id,
                            status: "dismissed",
                          })
                        }
                      >
                        Dispensar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (applyAction.isPending) return;
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action.confirmTitle ?? "Aplicar na Meta?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.insight.entityName
                ? `"${pending.insight.entityName}". `
                : ""}
              {pending?.action.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={applyAction.isPending}
              onClick={() => setPending(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={pending?.action.variant ?? "default"}
              disabled={applyAction.isPending}
              onClick={runApply}
            >
              {applyAction.isPending ? "Aplicando..." : "Aplicar na Meta"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
