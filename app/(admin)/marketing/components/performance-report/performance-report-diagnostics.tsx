"use client";

import { Badge } from "@/components/ui/badge";
import type { CampaignReportFact, DiagnosticFacts } from "@/lib/performance-report/types";
import {
  formatReportInteger,
  formatReportMoney,
  formatReportRoas,
  statusClass,
} from "./format";

type PerformanceReportDiagnosticsProps = {
  facts: DiagnosticFacts;
  currency: string | null;
  onOpenCampaign: (campaign: CampaignReportFact) => void;
};

export function PerformanceReportDiagnostics({
  facts,
  currency,
  onOpenCampaign,
}: PerformanceReportDiagnosticsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FactList
        title="Melhores por ROAS"
        campaigns={facts.bestByRoas}
        currency={currency}
        onOpenCampaign={onOpenCampaign}
      />
      <FactList
        title="Pedem atenção"
        campaigns={facts.needsAttention}
        currency={currency}
        onOpenCampaign={onOpenCampaign}
      />
      {facts.activeWithoutPurchases.length > 0 ? (
        <FactList
          title="Ativas sem compra"
          campaigns={facts.activeWithoutPurchases}
          currency={currency}
          onOpenCampaign={onOpenCampaign}
        />
      ) : null}
      {facts.roasInDecline.length > 0 ? (
        <div className="rounded-md border border-border/80 p-4">
          <p className="text-sm font-medium text-foreground">ROAS em queda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Comparado com a janela anterior — mesmo se o ROAS dos 30d ainda parecer bom.
          </p>
          <ul className="mt-2 space-y-2">
            {facts.roasInDecline.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded-md p-1 text-left hover:bg-muted/40"
                  onClick={() => {
                    const match =
                      facts.bestByRoas.find((campaign) => campaign.id === row.id) ??
                      facts.needsAttention.find((campaign) => campaign.id === row.id) ??
                      facts.activeWithoutPurchases.find(
                        (campaign) => campaign.id === row.id,
                      );
                    if (match) {
                      onOpenCampaign(match);
                      return;
                    }
                    onOpenCampaign({
                      id: row.id,
                      name: row.name,
                      accountId: row.accountId,
                    } as CampaignReportFact);
                  }}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{row.name}</span>
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-200 bg-amber-50 text-amber-700"
                    >
                      {row.dropPercent != null ? `−${row.dropPercent}%` : "Queda"}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.previousRoas != null && row.currentRoas != null
                      ? `ROAS ${formatReportRoas(row.previousRoas)} → ${formatReportRoas(row.currentRoas)} · ${row.lookbackDays}d vs. ${row.lookbackDays}d anteriores`
                      : row.evidence}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-md border border-border/80 p-4 text-sm">
        <p className="font-medium text-foreground">Concentração</p>
        <p className="mt-1 text-xs text-muted-foreground">{facts.concentration.scope}</p>
        {facts.concentration.leadingCampaign ? (
          <button
            type="button"
            className="mt-2 text-left text-sm text-foreground underline-offset-2 hover:underline"
            onClick={() =>
              onOpenCampaign(facts.concentration.leadingCampaign as CampaignReportFact)
            }
          >
            {facts.concentration.leadingCampaign.name}
            {facts.concentration.leadingCampaignShare !== null
              ? ` · ${Math.round(facts.concentration.leadingCampaignShare * 100)}% do valor de compra`
              : ""}
          </button>
        ) : (
          <p className="mt-2 text-muted-foreground">Sem valor de compra no recorte.</p>
        )}
      </div>
    </div>
  );
}

function FactList({
  title,
  campaigns,
  currency,
  onOpenCampaign,
}: {
  title: string;
  campaigns: CampaignReportFact[];
  currency: string | null;
  onOpenCampaign: (campaign: CampaignReportFact) => void;
}) {
  return (
    <div className="rounded-md border border-border/80 p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {campaigns.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma neste recorte.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 rounded-md p-1 text-left hover:bg-muted/40"
                onClick={() => onOpenCampaign(campaign)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{campaign.name}</span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${statusClass(campaign.tag)}`}
                  >
                    {campaign.tag}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  ROAS {formatReportRoas(campaign.roas)} · compras{" "}
                  {formatReportInteger(campaign.compras)} · gasto{" "}
                  {formatReportMoney(campaign.gasto, currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
