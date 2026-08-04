"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type PlaybookInsightRow,
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

type PlaybookInsightsPanelProps = {
  userId: string;
};

export function PlaybookInsightsPanel({ userId }: PlaybookInsightsPanelProps) {
  const query = usePlaybookInsights(userId);
  const updateStatus = useUpdatePlaybookInsightStatus(userId);
  const insights = query.data ?? [];

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
          {insights.map((insight) => (
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
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({
                          insightId: insight.id,
                          status: "acknowledged",
                        })
                      }
                    >
                      Reconhecer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({
                          insightId: insight.id,
                          status: "done",
                        })
                      }
                    >
                      Feito
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={updateStatus.isPending}
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
          ))}
        </ul>
      )}
    </div>
  );
}
