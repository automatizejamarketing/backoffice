"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, X, Info, Pencil } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AdSet,
  InsightsMetrics,
  TimeIncrement,
  DatePreset,
} from "@/lib/meta-business/types";
import { InsightsCards } from "./insights-cards";
import { InsightsChart } from "./insights-chart";
import { TimeIncrementSelector } from "./time-increment-selector";
import { AdsTable } from "./ads-table";
import { DateFilter } from "./date-filter";
import { AdSetEditDialog } from "./adset-edit-dialog";
import { AdSetEditHistory } from "./adset-edit-history";
import {
  getStatusBadgeVariant,
  formatDate,
  formatCurrency,
  translateStatus,
  getOptimizationGoalLabel,
  getOptimizationGoalDescription,
} from "../utils/formatters";
import { convertTimeIncrementToDays } from "@/lib/meta-business/convert-time-increment-to-days";

type AdSetDetailProps = {
  adSet: AdSet;
  accountId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
};

type GetAdSetInsightsResponse = {
  adsetId?: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
};

export function AdSetDetail({
  adSet,
  accountId,
  userId,
  isOpen,
  onClose,
}: AdSetDetailProps) {
  const [insightsData, setInsightsData] = useState<InsightsMetrics[]>([]);
  const [totalInsights, setTotalInsights] = useState<InsightsMetrics | undefined>(
    adSet.insights
  );
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

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
    DatePreset.LAST_30D
  );
  const [customRange, setCustomRange] = useState<{
    since: string;
    until: string;
  } | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!adSet.id || !accountId) return;

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
        `/api/meta-marketing/${accountId}/adsets/${adSet.id}/insights?${params}`
      );

      if (response.ok) {
        const data: GetAdSetInsightsResponse = await response.json();
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
        `/api/meta-marketing/${accountId}/adsets/${adSet.id}/insights?${totalParams}`
      );

      if (totalResponse.ok) {
        const totalData: GetAdSetInsightsResponse = await totalResponse.json();
        setTotalInsights(totalData.insights);
      }
    } catch (err) {
      console.error("Error fetching adset insights:", err);
    } finally {
      setIsLoadingInsights(false);
    }
  }, [adSet.id, accountId, userId, timeIncrement, datePreset, customRange]);

  useEffect(() => {
    if (isOpen) {
      fetchInsights();
    }
  }, [isOpen, fetchInsights]);

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
                  {adSet.name ?? "Detalhes do Conjunto de Anúncios"}
                </SheetTitle>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <Badge variant={getStatusBadgeVariant(adSet.effectiveStatus)}>
                    {translateStatus(adSet.effectiveStatus ?? adSet.status)}
                  </Badge>
                  {adSet.startTime && (
                    <span className="text-xs text-muted-foreground">
                      Início: {formatDate(adSet.startTime)}
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
                Editar
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
          {(adSet.dailyBudget || adSet.lifetimeBudget) && (
            <section className="flex flex-wrap gap-4 p-3 bg-muted/50 rounded-lg justify-between">
              {adSet.dailyBudget && (
                <div>
                  <span className="text-xs text-muted-foreground">
                    Orçamento Diário
                  </span>
                  <p className="font-medium">
                    {formatCurrency(parseInt(adSet.dailyBudget) / 100)}
                  </p>
                </div>
              )}
              {adSet.lifetimeBudget && (
                <div>
                  <span className="text-xs text-muted-foreground">
                    Orçamento Total
                  </span>
                  <p className="font-medium">
                    {formatCurrency(parseInt(adSet.lifetimeBudget) / 100)}
                  </p>
                </div>
              )}
              {adSet.budgetRemaining && (
                <div>
                  <span className="text-xs text-muted-foreground">
                    Orçamento Restante
                  </span>
                  <p className="font-medium">
                    {formatCurrency(parseInt(adSet.budgetRemaining) / 100)}
                  </p>
                </div>
              )}
              {adSet.optimizationGoal && (
                <div>
                  <span className="text-xs text-muted-foreground">
                    Objetivo de Otimização
                  </span>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">
                      {getOptimizationGoalLabel(adSet.optimizationGoal)}
                    </p>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="Ver descrição"
                        >
                          <Info className="size-3.5" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            {getOptimizationGoalLabel(adSet.optimizationGoal)}
                          </DialogTitle>
                          <DialogDescription className="text-left pt-2">
                            {getOptimizationGoalDescription(
                              adSet.optimizationGoal
                            )}
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              )}
            </section>
          )}

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
                      {metricOptions.find((o) => o.value === selectedMetric)?.label}
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
              Anúncios
            </h3>
            <AdsTable accountId={accountId} userId={userId} adSetId={adSet.id} />
          </section>

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Histórico de Alterações
            </h3>
            <AdSetEditHistory
              adsetId={adSet.id}
              accountId={accountId}
              refreshTrigger={historyRefreshTrigger}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <AdSetEditDialog
      adSet={adSet}
      accountId={accountId}
      userId={userId}
      isOpen={isEditOpen}
      onClose={() => setIsEditOpen(false)}
      onSuccess={() => {
        setHistoryRefreshTrigger((prev) => prev + 1);
      }}
    />
  </>
  );
}
