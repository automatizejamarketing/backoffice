"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CampaignReportFact } from "@/lib/performance-report/types";
import {
  formatReportInteger,
  formatReportMoney,
  formatReportRoas,
  formatReportShortDate,
  statusClass,
} from "./format";

type PerformanceReportCampaignsProps = {
  campaigns: CampaignReportFact[];
  currency: string | null;
  multipleAccounts: boolean;
  onOpenCampaign: (campaign: CampaignReportFact) => void;
};

export function PerformanceReportCampaigns({
  campaigns,
  currency,
  multipleAccounts,
  onOpenCampaign,
}: PerformanceReportCampaignsProps) {
  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma campanha visível no HUD neste período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {multipleAccounts ? <TableHead>Conta</TableHead> : null}
            <TableHead>Nome</TableHead>
            <TableHead>Início</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
            <TableHead className="text-right">Valor de compra</TableHead>
            <TableHead className="text-right">Compras</TableHead>
            <TableHead className="text-right">CPA</TableHead>
            <TableHead className="text-right">Gasto</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((campaign) => (
            <TableRow key={campaign.id}>
              {multipleAccounts ? (
                <TableCell className="whitespace-nowrap text-xs">
                  {campaign.accountLabel}
                </TableCell>
              ) : null}
              <TableCell className="max-w-[220px] truncate font-medium">
                {campaign.name}
              </TableCell>
              <TableCell>{formatReportShortDate(campaign.startDate)}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs ${statusClass(campaign.tag)}`}
                >
                  {campaign.tag}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {formatReportRoas(campaign.roas)}
              </TableCell>
              <TableCell className="text-right">
                {formatReportMoney(campaign.valorDeCompra, currency)}
              </TableCell>
              <TableCell className="text-right">
                {formatReportInteger(campaign.compras)}
              </TableCell>
              <TableCell className="text-right">
                {formatReportMoney(campaign.cpa, currency)}
              </TableCell>
              <TableCell className="text-right">
                {formatReportMoney(campaign.gasto, currency)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenCampaign(campaign)}
                >
                  Abrir
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
