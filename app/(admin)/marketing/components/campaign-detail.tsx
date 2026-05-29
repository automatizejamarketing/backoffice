"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCampaignInsights } from "../hooks/marketing-queries";
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
import { AdSetDetail } from "./adset-detail";
import { AdSetCreateDialog } from "./adset-create-dialog";
import { CampaignEditDialog } from "./campaign-edit-dialog";
import { DuplicateButton } from "./duplicate-button";
import { NameEditButton } from "./name-edit-button";
import {
  getCampaignMetricsForObjective,
  type CampaignMetricId,
} from "../utils/campaign-metrics";
import { getMetricLabel } from "../utils/metric-formatters";

type CampaignDetailProps = {
  campaign: Campaign;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onCampaignUpdated?: (campaign: Campaign) => void;
  selectedMetricIds?: CampaignMetricId[] | null;
};

export function CampaignDetail({
  campaign: campaignProp,
  accountId,
  userId,
  isOpen,
  onClose,
  onCampaignUpdated,
  selectedMetricIds,
}: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<Campaign>(campaignProp);
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

  useEffect(() => {
    setCampaign(campaignProp);
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

  const insightsQuery = useCampaignInsights(
    accountId,
    userId,
    campaign.id,
    {
      timeIncrement,
      datePreset,
      since: customRange?.since ?? null,
      until: customRange?.until ?? null,
    },
    { enabled: isOpen },
  );

  const insightsData = insightsQuery.data?.insightsArray ?? [];
  const totalInsights = insightsQuery.data?.total ?? campaign.insights;
  const isLoadingInsights = insightsQuery.isFetching;

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
    // The create dialog invalidates the marketing cache, so the ad set table
    // refetches on its own.
  };

  const handleCampaignEditSuccess = (updatedCampaign: Campaign) => {
    setCampaign(updatedCampaign);
    onCampaignUpdated?.(updatedCampaign);
    void refetchCampaign();
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[75vw] overflow-y-auto p-0"
        >
          <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 sm:hidden size-8"
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <SheetTitle className="line-clamp-1 text-left text-base font-semibold">
                      {campaign.name ?? "Detalhes da Campanha"}
                    </SheetTitle>
                    <NameEditButton
                      entityType="campaign"
                      entityId={campaign.id}
                      currentName={campaign.name}
                      accountId={accountId}
                      userId={userId}
                      onRenamed={(newName) => {
                        setCampaign((prev) => ({ ...prev, name: newName }));
                        onCampaignUpdated?.({ ...campaign, name: newName });
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant={getStatusBadgeVariant(campaign.effectiveStatus)}
                      className="text-[10px] py-0 h-4"
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
                <DuplicateButton
                  entityType="campaign"
                  entityId={campaign.id}
                  entityName={campaign.name}
                  accountId={accountId}
                  userId={userId}
                  variant="labeled"
                  onDuplicated={() => {
                    onCampaignUpdated?.(campaign);
                    onClose();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditOpen(true)}
                  className="shrink-0 h-8 text-xs"
                >
                  <Pencil className="size-3.5 mr-1.5" />
                  Editar Campanha
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="shrink-0 hidden sm:flex size-8 text-muted-foreground"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="px-4 py-5 sm:px-6 sm:py-6 space-y-6">
            <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Configuração de Orçamento
                  </p>
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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Orçamento diário da campanha
                    </span>
                    <p className="font-semibold text-sm mt-0.5 tabular-nums">
                      {campaign.dailyBudget
                        ? formatCurrency(
                            Number.parseInt(campaign.dailyBudget, 10) / 100,
                          )
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Orçamento vitalício
                    </span>
                    <p className="font-semibold text-sm mt-0.5 tabular-nums">
                      {campaign.lifetimeBudget
                        ? formatCurrency(
                            Number.parseInt(campaign.lifetimeBudget, 10) / 100,
                          )
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Início
                    </span>
                    <p className="font-semibold text-sm mt-0.5">
                      {formatDate(campaign.startTime)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Término
                    </span>
                    <p className="font-semibold text-sm mt-0.5">
                      {formatDate(campaign.stopTime)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Período
                </p>
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Métricas Totais
              </p>
              <InsightsCards
                insights={totalInsights}
                isLoading={isLoadingInsights}
                objective={campaign.objective}
              />
            </section>

            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Desempenho ao Longo do Tempo
                </p>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
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
                    <SelectTrigger className="w-full sm:w-[130px] h-8 text-xs">
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Conjuntos de Anúncios
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCreateAdSetOpen(true)}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Plus className="size-3.5" />
                  Novo Conjunto
                </Button>
              </div>
              <AdSetsTable
                accountId={accountId}
                userId={userId}
                campaignId={campaign.id}
                objective={campaign.objective}
                datePreset={datePreset}
                customRange={customRange}
                selectedMetricIds={selectedMetricIds}
                onAdSetClick={handleAdSetClick}
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
          objective={campaign.objective}
          selectedMetricIds={selectedMetricIds}
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

