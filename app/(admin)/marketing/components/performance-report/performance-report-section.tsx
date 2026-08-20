"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignReportFact } from "@/lib/performance-report/types";
import { usePerformanceReport } from "../../hooks/use-performance-report";
import { formatGeneratedAt } from "./format";
import { PerformanceReportCampaigns } from "./performance-report-campaigns";
import { PerformanceReportDiagnostics } from "./performance-report-diagnostics";
import { PerformanceReportTotals } from "./performance-report-totals";

type PerformanceReportSectionProps = {
  userId: string;
  accountId?: string | null;
  campaignId?: string | null;
  datePreset?: string | null;
  since?: string | null;
  until?: string | null;
  enabled: boolean;
  onOpenCampaign: (campaign: CampaignReportFact) => void;
};

export function PerformanceReportSection({
  userId,
  accountId,
  campaignId,
  datePreset,
  since,
  until,
  enabled,
  onOpenCampaign,
}: PerformanceReportSectionProps) {
  const query = usePerformanceReport(
    userId,
    {
      accountId: accountId ?? undefined,
      campaignId: campaignId ?? undefined,
      datePreset,
      since,
      until,
    },
    { enabled },
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Relatório consolidado</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Dados atuais da Meta. Reabrir o link pode alterar os números em
            relação à mensagem do Slack.
          </p>
          {query.data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Gerado em {formatGeneratedAt(query.data.generatedAt)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Ver dados atuais
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Montando o relatório…</p>
        ) : null}
        {query.isError ? (
          <p className="text-sm text-red-600">
            {query.error instanceof Error
              ? query.error.message
              : "Falha ao carregar o relatório."}
          </p>
        ) : null}
        {query.data ? (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                Cliente:{" "}
                <span className="text-foreground">
                  {query.data.client.name ?? query.data.client.email}
                </span>
              </span>
              {query.data.client.plano ? (
                <span>
                  Plano:{" "}
                  <span className="text-foreground">{query.data.client.plano}</span>
                </span>
              ) : null}
              {query.data.client.renovacao ? (
                <span>
                  Renovação:{" "}
                  <span className="text-foreground">
                    {query.data.client.renovacao}
                  </span>
                </span>
              ) : null}
              <span>{query.data.client.situacaoMeta}</span>
            </div>
            <PerformanceReportTotals report={query.data} />
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Campanhas</h3>
              <PerformanceReportCampaigns
                campaigns={query.data.campaigns}
                currency={query.data.accountTotals.currency}
                multipleAccounts={query.data.client.contasDeAnuncio.length > 1}
                onOpenCampaign={onOpenCampaign}
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Diagnóstico</h3>
              <PerformanceReportDiagnostics
                facts={query.data.diagnosticFacts}
                currency={query.data.accountTotals.currency}
                onOpenCampaign={onOpenCampaign}
              />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
