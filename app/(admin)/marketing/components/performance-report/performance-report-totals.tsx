"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClientPerformanceReportV1 } from "@/lib/performance-report/types";
import {
  formatReportInteger,
  formatReportMoney,
  formatReportRoas,
  formatReportShortDate,
} from "./format";

type PerformanceReportTotalsProps = {
  report: ClientPerformanceReportV1;
};

export function PerformanceReportTotals({
  report,
}: PerformanceReportTotalsProps) {
  const totals = report.accountTotals;
  const currency = totals.currency;
  const periodStart = formatReportShortDate(totals.period.dateStart);
  const periodStop = formatReportShortDate(totals.period.dateStop);

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Totais da conta</CardTitle>
        <p className="text-xs text-muted-foreground">{totals.scope}</p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-xs text-muted-foreground">
          {periodStart !== "—" && periodStop !== "—"
            ? `${periodStart} a ${periodStop} · ${totals.period.windowDays} dias`
            : `${totals.period.windowDays} dias`}
        </p>
        {totals.consolidated ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Gasto Meta" value={formatReportMoney(totals.gasto, currency)} />
            <Metric label="Compras" value={formatReportInteger(totals.compras)} />
            <Metric
              label="Valor de compra"
              value={formatReportMoney(totals.valorDeCompra, currency)}
            />
            <Metric label="CPA" value={formatReportMoney(totals.cpa, currency)} />
            <Metric label="ROAS Meta" value={formatReportRoas(totals.roasMeta)} />
            <Metric
              label="ROAS Ajustado"
              value={formatReportRoas(totals.roasAjustado)}
            />
            <Metric
              label="Impressões"
              value={formatReportInteger(totals.impressoes)}
            />
            <Metric label="Cliques" value={formatReportInteger(totals.cliques)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {totals.unavailableReasonLabel ??
              "Não foi possível consolidar os totais."}
          </p>
        )}
        {totals.unavailableReasonLabel && totals.consolidated ? (
          <p className="text-xs text-muted-foreground">
            {totals.unavailableReasonLabel}
          </p>
        ) : null}
        {report.client.contasDeAnuncio.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {report.client.contasDeAnuncio.map((account) => (
              <Badge key={account.accountId} variant="outline" className="text-xs">
                {account.label ?? account.accountId}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
