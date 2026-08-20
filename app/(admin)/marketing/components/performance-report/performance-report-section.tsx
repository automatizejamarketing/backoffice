"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
  defaultOpen?: boolean;
  onOpenCampaign: (campaign: CampaignReportFact) => void;
};

export function PerformanceReportSection({
  userId,
  accountId,
  campaignId,
  datePreset,
  since,
  until,
  defaultOpen = false,
  onOpenCampaign,
}: PerformanceReportSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const query = usePerformanceReport(
    userId,
    {
      accountId: accountId ?? undefined,
      campaignId: campaignId ?? undefined,
      datePreset,
      since,
      until,
    },
    { enabled: open },
  );

  const generateLabel = query.data ? "Mostrar relatório" : "Gerar relatório";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="flex items-center gap-1.5 text-left"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <CardTitle>Relatório consolidado</CardTitle>
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            Dados atuais da Meta. Só consulta a API ao gerar ou ao abrir pelo
            Slack. Reabrir o link pode alterar os números da mensagem.
          </p>
          {query.data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Gerado em {formatGeneratedAt(query.data.generatedAt)}
            </p>
          ) : null}
        </div>
        {open ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            Ver dados atuais
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            {generateLabel}
          </Button>
        )}
      </CardHeader>
      {open ? (
        <CardContent className="space-y-6">
          {query.isLoading || (query.isFetching && !query.data) ? (
            <p className="text-sm text-muted-foreground">
              Montando o relatório…
            </p>
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
                    <span className="text-foreground">
                      {query.data.client.plano}
                    </span>
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
                <h3 className="text-sm font-medium text-foreground">
                  Campanhas
                </h3>
                <PerformanceReportCampaigns
                  campaigns={query.data.campaigns}
                  currency={query.data.accountTotals.currency}
                  multipleAccounts={query.data.client.contasDeAnuncio.length > 1}
                  onOpenCampaign={onOpenCampaign}
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  Diagnóstico
                </h3>
                <PerformanceReportDiagnostics
                  facts={query.data.diagnosticFacts}
                  currency={query.data.accountTotals.currency}
                  onOpenCampaign={onOpenCampaign}
                />
              </div>
            </>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
