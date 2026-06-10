"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdSets, useToggleAdSetStatus } from "../hooks/marketing-queries";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdSetStatus,
  DatePreset,
  EffectiveStatus,
  type AdSet,
  type CampaignObjective,
} from "@/lib/meta-business/types";
import {
  resolveCampaignTableMetrics,
  type CampaignMetricId,
} from "../utils/campaign-metrics";
import {
  formatMetricValue,
  getMetricLabel,
} from "../utils/metric-formatters";
import { DeliveryStatus } from "./delivery-status";
import { DuplicateButton } from "./duplicate-button";
import { IssuesIcon } from "./issues-icon";
import { NameEditButton } from "./name-edit-button";

type AdSetsTableProps = {
  accountId: string;
  userId: string;
  campaignId?: string;
  /**
   * Objective of the parent campaign. Drives which metrics appear in the
   * mobile cards and desktop "Métricas principais" column so an ad set in a
   * sales campaign shows ROAS/CPA/etc. instead of generic spend/clicks.
   */
  objective?: CampaignObjective;
  datePreset?: DatePreset | null;
  customRange?: { since: string; until: string } | null;
  selectedMetricIds?: CampaignMetricId[] | null;
  onAdSetClick: (adSet: AdSet) => void;
};

export function AdSetsTable({
  accountId,
  userId,
  campaignId,
  objective,
  datePreset,
  customRange,
  selectedMetricIds,
  onAdSetClick,
}: AdSetsTableProps) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [togglingAdSetId, setTogglingAdSetId] = useState<string | null>(null);

  const mobileMetrics = resolveCampaignTableMetrics(
    objective,
    "mobileList",
    selectedMetricIds,
  );
  const desktopMetrics = resolveCampaignTableMetrics(
    objective,
    "desktopList",
    selectedMetricIds,
  );
  const desktopMetricCount = desktopMetrics.length;
  const desktopMetricsGridStyle = {
    gridTemplateColumns: `repeat(${desktopMetricCount}, minmax(0, 1fr))`,
  };
  const desktopMetricsMinWidth = Math.max(420, desktopMetricCount * 110);

  const { data, isPending, isFetching, error, refetch } = useAdSets(
    accountId,
    userId,
    {
      campaignId: campaignId ?? null,
      datePreset,
      since: customRange?.since ?? null,
      until: customRange?.until ?? null,
      cursor: cursor ?? null,
    },
  );

  const adSets = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  const isInitialLoading = isPending;

  const toggleStatus = useToggleAdSetStatus(accountId, userId);

  const handleToggleStatus = (adSet: AdSet, event: React.MouseEvent) => {
    event.stopPropagation();

    if (togglingAdSetId) return;

    const newStatus =
      adSet.status === AdSetStatus.ACTIVE
        ? AdSetStatus.PAUSED
        : AdSetStatus.ACTIVE;

    setTogglingAdSetId(adSet.id);
    toggleStatus.mutate(
      { adsetId: adSet.id, nextStatus: newStatus },
      { onSettled: () => setTogglingAdSetId(null) },
    );
  };

  const canToggle = (adSet: AdSet): boolean => {
    const status = adSet.effectiveStatus ?? adSet.status;
    return (
      status === EffectiveStatus.ACTIVE || status === EffectiveStatus.PAUSED
    );
  };

  const isActive = (adSet: AdSet): boolean => {
    return adSet.status === AdSetStatus.ACTIVE;
  };

  const handleNextPage = () => {
    if (pagination?.nextCursor) {
      setCursor(pagination.nextCursor);
    }
  };

  const handlePreviousPage = () => {
    if (pagination?.previousCursor) {
      setCursor(pagination.previousCursor);
    }
  };

  if (isInitialLoading && adSets.length === 0) {
    return <AdSetsTableSkeleton metricCount={desktopMetricCount} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-destructive text-sm">
          Falha ao buscar conjuntos de anúncios
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (adSets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-muted-foreground text-sm">
          Nenhum conjunto de anúncios encontrado
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-2">
        {adSets.map((adSet) => (
          <div
            key={adSet.id}
            role="button"
            tabIndex={0}
            onClick={() => onAdSetClick(adSet)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdSetClick(adSet);
              }
            }}
            className="w-full cursor-pointer text-left rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-start gap-1 flex-1 min-w-0">
                <span className="font-medium text-sm line-clamp-2">
                  {adSet.name}
                </span>
                <NameEditButton
                  entityType="adset"
                  entityId={adSet.id}
                  currentName={adSet.name}
                  accountId={accountId}
                  userId={userId}
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canToggle(adSet) && (
                  <div
                    onClick={(e) => handleToggleStatus(adSet, e)}
                    className="relative"
                  >
                    {togglingAdSetId === adSet.id ? (
                      <div className="w-9 h-5 flex items-center justify-center">
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Switch
                        checked={isActive(adSet)}
                        disabled={togglingAdSetId !== null}
                        aria-label="Alternar status"
                        className="scale-90"
                      />
                    )}
                  </div>
                )}
                <IssuesIcon entity={adSet} entityType="adset" />
                <DeliveryStatus
                  status={adSet.effectiveStatus ?? adSet.status}
                  endTime={adSet.endTime}
                  size="xs"
                />
                <DuplicateButton
                  entityType="adset"
                  entityId={adSet.id}
                  entityName={adSet.name}
                  accountId={accountId}
                  userId={userId}
                  objective={objective}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {mobileMetrics.map((metric) => (
                <div key={metric.id}>
                  <span className="block text-xs font-semibold tabular-nums">
                    {formatMetricValue(metric, adSet.insights)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {getMetricLabel(metric.labelKey)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block rounded-xl border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-[60px] text-xs">Ativo</TableHead>
                <TableHead className="min-w-[180px] text-xs">Conjunto de Anúncios</TableHead>
                <TableHead className="w-[40px] text-xs" aria-label="Avisos" />
                <TableHead className="w-[130px] text-xs">Veiculação</TableHead>
                <TableHead className="text-xs" style={{ minWidth: desktopMetricsMinWidth }}>
                  Métricas principais
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-9" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-3" style={desktopMetricsGridStyle}>
                          {Array.from({ length: desktopMetricCount }).map((_, j) => (
                            <div key={j}>
                              <Skeleton className="h-4 w-12 mb-1" />
                              <Skeleton className="h-3 w-16" />
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                : adSets.map((adSet) => (
                    <TableRow
                      key={adSet.id}
                      className="cursor-pointer hover:bg-accent/40"
                      onClick={() => onAdSetClick(adSet)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(adSet) ? (
                          togglingAdSetId === adSet.id ? (
                            <div className="w-9 h-5 flex items-center justify-center">
                              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(adSet)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(adSet, e)}
                              disabled={togglingAdSetId !== null}
                              aria-label="Alternar status"
                              className="scale-90"
                            />
                          )
                        ) : (
                          <div className="w-9 h-5" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="line-clamp-1">{adSet.name}</span>
                          <NameEditButton
                            entityType="adset"
                            entityId={adSet.id}
                            currentName={adSet.name}
                            accountId={accountId}
                            userId={userId}
                          />
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IssuesIcon entity={adSet} entityType="adset" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DeliveryStatus
                            status={
                              adSet.effectiveStatus ?? adSet.status ?? null
                            }
                            endTime={adSet.endTime}
                          />
                          <DuplicateButton
                            entityType="adset"
                            entityId={adSet.id}
                            entityName={adSet.name}
                            accountId={accountId}
                            userId={userId}
                            objective={objective}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-3" style={desktopMetricsGridStyle}>
                          {desktopMetrics.map((metric) => (
                            <div key={metric.id} className="min-w-0">
                              <div className="tabular-nums text-sm font-medium">
                                {formatMetricValue(metric, adSet.insights)}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {getMetricLabel(metric.labelKey)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && (pagination.hasNextPage || pagination.hasPreviousPage) && (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreviousPage}
            disabled={!pagination.hasPreviousPage || isFetching}
            className="h-8 px-3 text-xs gap-1"
          >
            <ChevronLeft className="size-3.5" />
            Anterior
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNextPage}
            disabled={!pagination.hasNextPage || isFetching}
            className="h-8 px-3 text-xs gap-1"
          >
            Próxima
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AdSetsTableSkeleton({ metricCount = 5 }: { metricCount?: number }) {
  const metricsGridStyle = {
    gridTemplateColumns: `repeat(${metricCount}, minmax(0, 1fr))`,
  };

  return (
    <div className="space-y-3">
      <div className="block sm:hidden space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-9" />
                <Skeleton className="h-4 w-14" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-3.5 w-14 mb-1" />
                  <Skeleton className="h-2.5 w-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-[60px] text-xs">Ativo</TableHead>
              <TableHead className="min-w-[180px] text-xs">Conjunto de Anúncios</TableHead>
              <TableHead className="w-[40px] text-xs" aria-label="Avisos" />
              <TableHead className="w-[130px] text-xs">Veiculação</TableHead>
              <TableHead
                className="text-xs"
                style={{ minWidth: Math.max(420, metricCount * 110) }}
              >
                Métricas principais
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-5 w-9" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell />
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <div className="grid gap-3" style={metricsGridStyle}>
                    {Array.from({ length: metricCount }).map((_, j) => (
                      <div key={j}>
                        <Skeleton className="h-4 w-12 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
