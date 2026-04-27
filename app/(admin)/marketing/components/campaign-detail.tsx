"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Campaign,
  type AdSet,
  type InsightsMetrics,
  type TimeIncrement,
  DatePreset,
} from "@/lib/meta-business/types";
import { InsightsCards } from "./insights-cards";
import { InsightsChart } from "./insights-chart";
import { TimeIncrementSelector } from "./time-increment-selector";
import { AdSetsTable } from "./adsets-table";
import { DateFilter } from "./date-filter";
import {
  getStatusBadgeVariant,
  formatDate,
  formatCurrency,
  translateStatus,
} from "../utils/formatters";
import { convertTimeIncrementToDays } from "@/lib/meta-business/convert-time-increment-to-days";
import { AdSetDetail } from "./adset-detail";
import { AdSetCreateDialog } from "./adset-create-dialog";
import { CampaignEditDialog } from "./campaign-edit-dialog";
import {
  getCampaignMetricsForObjective,
  type CampaignMetricId,
} from "../utils/campaign-metrics";

type CampaignDetailProps = {
  campaign: Campaign;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onCampaignUpdated?: (campaign: Campaign) => void;
};

type GetCampaignInsightsResponse = {
  campaignId?: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
};

export function CampaignDetail({
  campaign: campaignProp,
  accountId,
  userId,
  isOpen,
  onClose,
  onCampaignUpdated,
}: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<Campaign>(campaignProp);
  const [insightsData, setInsightsData] = useState<InsightsMetrics[]>([]);
  const [totalInsights, setTotalInsights] = useState<
    InsightsMetrics | undefined
  >(campaignProp.insights);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const [timeIncrement, setTimeIncrement] = useState<TimeIncrement>("day");
  const chartMetrics = useMemo(
    () => getCampaignMetricsForObjective(campaign.objective, "chart"),
    [campaign.objective],
  );
  const [selectedMetric, setSelectedMetric] = useState<CampaignMetricId>(
    chartMetrics[0]?.id ?? "spend",
  );

  const metricOptions = useMemo(
    () =>
      chartMetrics.map((metric) => ({
        value: metric.id,
        label: getMetricLabel(metric.labelKey),
      })),
    [chartMetrics],
  );

  const [datePreset, setDatePreset] = useState<DatePreset | null>(
    DatePreset.LAST_30D,
  );
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(null);

  const [selectedAdSet, setSelectedAdSet] = useState<AdSet | null>(null);
  const [isAdSetDetailOpen, setIsAdSetDetailOpen] = useState(false);
  const [isCreateAdSetOpen, setIsCreateAdSetOpen] = useState(false);
  const [adSetsRefreshKey, setAdSetsRefreshKey] = useState(0);

  useEffect(() => {
    setCampaign(campaignProp);
    setTotalInsights(campaignProp.insights);
  }, [campaignProp]);

  const refetchCampaign = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/campaigns/${campaign.id}?userId=${userId}`,
      );
      if (!response.ok) return;

      const data: { campaign?: Campaign } = await response.json();
      if (data.campaign) {
        setCampaign(data.campaign);
        onCampaignUpdated?.(data.campaign);
      }
    } catch {
      // best-effort refresh; the previous response already succeeded
    }
  }, [accountId, campaign.id, onCampaignUpdated, userId]);

  const fetchInsights = useCallback(async () => {
    if (!campaign.id || !accountId) return;

    setIsLoadingInsights(true);

    try {
      const params = new URLSearchParams({
        timeIncrement: convertTimeIncrementToDays(timeIncrement),
        userId,
      });

      if (customRange) {
        params.append("since", customRange.since);
        params.append("until", customRange.until);
      } else if (datePreset) {
        params.append("datePreset", datePreset);
      }

      const response = await fetch(
        `/api/meta-marketing/${accountId}/campaigns/${campaign.id}/insights?${params}`,
      );

      if (response.ok) {
        const data: GetCampaignInsightsResponse = await response.json();
        setInsightsData(data.insightsArray ?? []);
      }

      const totalParams = new URLSearchParams({ userId });
      if (customRange) {
        totalParams.append("since", customRange.since);
        totalParams.append("until", customRange.until);
      } else if (datePreset) {
        totalParams.append("datePreset", datePreset);
      } else {
        totalParams.append("datePreset", DatePreset.LAST_30D);
      }

      const totalResponse = await fetch(
        `/api/meta-marketing/${accountId}/campaigns/${campaign.id}/insights?${totalParams}`,
      );

      if (totalResponse.ok) {
        const totalData: GetCampaignInsightsResponse =
          await totalResponse.json();
        setTotalInsights(totalData.insights);
      }
    } catch (err) {
      console.error("Error fetching campaign insights:", err);
    } finally {
      setIsLoadingInsights(false);
    }
  }, [campaign.id, accountId, userId, timeIncrement, datePreset, customRange]);

  useEffect(() => {
    if (isOpen) {
      fetchInsights();
    }
  }, [isOpen, fetchInsights]);

  useEffect(() => {
    setSelectedMetric(chartMetrics[0]?.id ?? "spend");
  }, [chartMetrics]);

  const handleAdSetClick = (adSet: AdSet) => {
    setSelectedAdSet(adSet);
    setIsAdSetDetailOpen(true);
  };

  const handleCloseAdSetDetail = () => {
    setIsAdSetDetailOpen(false);
    setSelectedAdSet(null);
  };

  const handleCreateAdSetSuccess = () => {
    setAdSetsRefreshKey((prev) => prev + 1);
  };

  const handleCampaignEditSuccess = (updatedCampaign: Campaign) => {
    setCampaign(updatedCampaign);
    onCampaignUpdated?.(updatedCampaign);
    setAdSetsRefreshKey((prev) => prev + 1);
    void refetchCampaign();
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[75vw] overflow-y-auto p-0"
        >
          <SheetHeader className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 sm:hidden"
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <div className="min-w-0">
                  <SheetTitle className="line-clamp-1 text-left">
                    {campaign.name ?? "Detalhes da Campanha"}
                  </SheetTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant={getStatusBadgeVariant(campaign.effectiveStatus)}
                    >
                      {translateStatus(
                        campaign.effectiveStatus ?? campaign.status,
                      )}
                    </Badge>
                    {campaign.startTime && (
                      <span className="text-xs text-muted-foreground">
                        Início: {formatDate(campaign.startTime)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditOpen(true)}
                  className="shrink-0"
                >
                  <Pencil className="size-4 mr-2" />
                  Editar Campanha
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 hidden sm:flex"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="px-4 py-4 sm:px-6 sm:py-6 space-y-6">
            <section className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Configuração de Orçamento
                  </h3>
                  <p className="text-sm font-semibold">
                    {campaign.budgetMode === "CBO"
                      ? "CBO (Campaign Budget Optimization)"
                      : "ABO (Ad Set Budget Optimization)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.budgetMode === "CBO"
                      ? "O orçamento é controlado no nível da campanha."
                      : "O orçamento é controlado no nível dos conjuntos de anúncios."}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Orçamento diário da campanha
                    </span>
                    <p className="font-medium">
                      {campaign.dailyBudget
                        ? formatCurrency(Number.parseInt(campaign.dailyBudget, 10) / 100)
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Orçamento vitalício
                    </span>
                    <p className="font-medium">
                      {campaign.lifetimeBudget
                        ? formatCurrency(
                            Number.parseInt(campaign.lifetimeBudget, 10) / 100,
                          )
                        : "-"}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Período
                </h3>
                <DateFilter
                  datePreset={datePreset}
                  onDatePresetChange={(preset) => {
                    setDatePreset(preset);
                    setCustomRange(null);
                  }}
                  customRange={customRange}
                  onCustomRangeChange={(range) => {
                    setCustomRange(range);
                    setDatePreset(null);
                  }}
                />
              </div>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Métricas Totais
              </h3>
              <InsightsCards
                insights={totalInsights}
                isLoading={isLoadingInsights}
                objective={campaign.objective}
              />
            </section>

            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Desempenho ao Longo do Tempo
                </h3>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <TimeIncrementSelector
                    value={timeIncrement}
                    onChange={setTimeIncrement}
                    disabled={isLoadingInsights}
                  />
                  <Select
                    value={selectedMetric}
                    onValueChange={(v) =>
                      setSelectedMetric(v as typeof selectedMetric)
                    }
                  >
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <SelectValue placeholder="Selecione uma métrica" />
                    </SelectTrigger>
                    <SelectContent>
                      {metricOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <InsightsChart
                data={insightsData}
                isLoading={isLoadingInsights}
                metric={selectedMetric}
              />
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Conjuntos de Anúncios
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCreateAdSetOpen(true)}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Novo Conjunto
                </Button>
              </div>
              <AdSetsTable
                accountId={accountId}
                userId={userId}
                campaignId={campaign.id}
                onAdSetClick={handleAdSetClick}
                refreshKey={adSetsRefreshKey}
              />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {selectedAdSet && (
        <AdSetDetail
          adSet={selectedAdSet}
          accountId={accountId}
          userId={userId}
          isOpen={isAdSetDetailOpen}
          onClose={handleCloseAdSetDetail}
        />
      )}

      <AdSetCreateDialog
        campaignId={campaign.id}
        campaignName={campaign.name}
        campaignObjective={campaign.objective}
        accountId={accountId}
        userId={userId}
        isOpen={isCreateAdSetOpen}
        onClose={() => setIsCreateAdSetOpen(false)}
        onSuccess={handleCreateAdSetSuccess}
      />

      <CampaignEditDialog
        campaign={campaign}
        accountId={accountId}
        userId={userId}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onSuccess={handleCampaignEditSuccess}
      />
    </>
  );
}

function getMetricLabel(labelKey: string): string {
  const labels: Record<string, string> = {
    spend: "Gasto",
    impressions: "Impressões",
    clicks: "Cliques",
    reach: "Alcance",
    cpc: "CPC",
    ctr: "CTR",
    cpm: "CPM",
    roas: "ROAS",
    cpa: "CPA",
    purchaseValue: "Valor de compra",
    numberOfPurchases: "Compras",
    linkClicks: "Cliques no link",
    landingPageViews: "Views da página",
    cpl: "CPL",
    numberOfLeads: "Leads",
  };

  return labels[labelKey] ?? labelKey;
}
