"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, X } from "lucide-react";
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
  translateStatus,
} from "../utils/formatters";
import { convertTimeIncrementToDays } from "@/lib/meta-business/convert-time-increment-to-days";
import { AdSetDetail } from "./adset-detail";

type CampaignDetailProps = {
  campaign: Campaign;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
};

type GetCampaignInsightsResponse = {
  campaignId?: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
};

export function CampaignDetail({
  campaign,
  accountId,
  userId,
  isOpen,
  onClose,
}: CampaignDetailProps) {
  const [insightsData, setInsightsData] = useState<InsightsMetrics[]>([]);
  const [totalInsights, setTotalInsights] = useState<
    InsightsMetrics | undefined
  >(campaign.insights);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  const [timeIncrement, setTimeIncrement] = useState<TimeIncrement>("day");
  const [selectedMetric, setSelectedMetric] = useState<
    "spend" | "impressions" | "clicks" | "cpc" | "cpm"
  >("spend");

  const metricOptions = [
    { value: "spend" as const, label: "Gasto" },
    { value: "impressions" as const, label: "Impressões" },
    { value: "clicks" as const, label: "Cliques" },
    { value: "cpc" as const, label: "CPC" },
    { value: "cpm" as const, label: "CPM" },
  ] as const;

  const [datePreset, setDatePreset] = useState<DatePreset | null>(
    DatePreset.LAST_30D,
  );
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(null);

  const [selectedAdSet, setSelectedAdSet] = useState<AdSet | null>(null);
  const [isAdSetDetailOpen, setIsAdSetDetailOpen] = useState(false);

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

  const handleAdSetClick = (adSet: AdSet) => {
    setSelectedAdSet(adSet);
    setIsAdSetDetailOpen(true);
  };

  const handleCloseAdSetDetail = () => {
    setIsAdSetDetailOpen(false);
    setSelectedAdSet(null);
  };

  return (
    <>
      <Sheet
        open={isOpen}
        onOpenChange={(open) => !open && onClose()}
        modal={false}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[75vw] overflow-y-auto p-0"
          onPointerDownOutside={(e) => {
            if (isAdSetDetailOpen) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (isAdSetDetailOpen) e.preventDefault();
          }}
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
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="shrink-0 hidden sm:flex"
              >
                <X className="size-4" />
              </Button>
            </div>
          </SheetHeader>

          <div className="px-4 py-4 sm:px-6 sm:py-6 space-y-6">
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
                      <SelectValue>
                        {
                          metricOptions.find((o) => o.value === selectedMetric)
                            ?.label
                        }
                      </SelectValue>
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
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Conjuntos de Anúncios
              </h3>
              <AdSetsTable
                accountId={accountId}
                userId={userId}
                campaignId={campaign.id}
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
          isOpen={isAdSetDetailOpen}
          onClose={handleCloseAdSetDetail}
        />
      )}
    </>
  );
}
