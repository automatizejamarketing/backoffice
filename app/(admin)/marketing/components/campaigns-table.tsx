"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCampaigns, useToggleCampaignStatus } from "../hooks/marketing-queries";
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
  CampaignStatus,
  EffectiveStatus,
  type Campaign,
  type DatePreset,
} from "@/lib/meta-business/types";
import type { CampaignObjectiveFilter } from "@/lib/meta-business/campaign-objectives";
import type {
  CampaignSortMetric,
  SortOrder,
} from "@/lib/meta-business/campaign-sort";
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

type CampaignsTableProps = {
  accountId: string;
  userId: string; // Required: identifies which user's token to use
  onCampaignClick: (campaign: Campaign) => void;
  refreshKey?: number;
  /**
   * Date preset to scope the insights subquery (e.g. `TODAY`, `LAST_30D`).
   * When both this and `customRange` are unset the API returns lifetime totals.
   */
  datePreset?: DatePreset | null;
  /** Custom YYYY-MM-DD window that supersedes `datePreset`. */
  customRange?: { since: string; until: string } | null;
  /** Objective filter, owned by the parent toolbar (default `"all"`). */
  objectiveFilter: CampaignObjectiveFilter;
  /** Metric to sort by, or `null` for the default status order. */
  sortMetric: CampaignSortMetric | null;
  sortOrder: SortOrder;
  selectedMetricIds?: CampaignMetricId[] | null;
};

const PAGE_SIZE = 25;
const MAX_CAMPAIGNS = 500;

export function CampaignsTable({
  accountId,
  userId,
  onCampaignClick,
  datePreset,
  customRange,
  objectiveFilter,
  sortMetric,
  sortOrder,
  selectedMetricIds,
}: CampaignsTableProps) {
  const [page, setPage] = useState(0);
  const [togglingCampaignId, setTogglingCampaignId] = useState<string | null>(
    null
  );

  const { data, isPending, isFetching, error, refetch } = useCampaigns(
    accountId,
    userId,
    {
      datePreset,
      since: customRange?.since ?? null,
      until: customRange?.until ?? null,
      objectiveFilter,
      sortMetric,
      sortOrder,
    },
  );

  const campaigns = data?.data ?? [];
  const isInitialLoading = isPending;

  // Reset to the first page whenever the active filter/sort changes. Done as a
  // render-time adjustment (the React-recommended pattern) instead of an effect.
  const filterSignature = `${datePreset ?? ""}|${customRange?.since ?? ""}|${
    customRange?.until ?? ""
  }|${objectiveFilter}|${sortMetric ?? ""}|${sortOrder}`;
  const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature);
  if (lastFilterSignature !== filterSignature) {
    setLastFilterSignature(filterSignature);
    setPage(0);
  }

  const toggleStatus = useToggleCampaignStatus(accountId, userId);

  const handleToggleStatus = (campaign: Campaign, event: React.MouseEvent) => {
    event.stopPropagation();

    if (togglingCampaignId) return;

    const newStatus =
      campaign.status === CampaignStatus.ACTIVE
        ? CampaignStatus.PAUSED
        : CampaignStatus.ACTIVE;

    setTogglingCampaignId(campaign.id);
    toggleStatus.mutate(
      { campaignId: campaign.id, nextStatus: newStatus },
      { onSettled: () => setTogglingCampaignId(null) },
    );
  };

  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedCampaigns = campaigns.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const handleNextPage = () => {
    setPage((p) => Math.min(totalPages - 1, p + 1));
  };

  const handlePreviousPage = () => {
    setPage((p) => Math.max(0, p - 1));
  };

  const canToggle = (campaign: Campaign): boolean => {
    const status = campaign.effectiveStatus ?? campaign.status;
    return (
      status === EffectiveStatus.ACTIVE || status === EffectiveStatus.PAUSED
    );
  };

  const isActive = (campaign: Campaign): boolean => {
    return campaign.status === CampaignStatus.ACTIVE;
  };

  const getMobileMetrics = (campaign: Campaign) =>
    resolveCampaignTableMetrics(
      campaign.objective,
      "mobileList",
      selectedMetricIds,
    );

  const getDesktopMetrics = (campaign: Campaign) =>
    resolveCampaignTableMetrics(
      campaign.objective,
      "desktopList",
      selectedMetricIds,
    );

  const desktopMetricCount =
    selectedMetricIds && selectedMetricIds.length > 0
      ? selectedMetricIds.length
      : 5;
  const desktopMetricsMinWidth = Math.max(420, desktopMetricCount * 110);
  const desktopMetricsGridStyle = {
    gridTemplateColumns: `repeat(${desktopMetricCount}, minmax(0, 1fr))`,
  };

  if (isInitialLoading && campaigns.length === 0) {
    return <CampaignsTableSkeleton metricCount={desktopMetricCount} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <p className="text-sm text-destructive">Falha ao buscar campanhas</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma campanha encontrada
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-2">
        {pagedCampaigns.map((campaign) => (
          <div
            key={campaign.id}
            role="button"
            tabIndex={0}
            onClick={() => onCampaignClick(campaign)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCampaignClick(campaign);
              }
            }}
            className="w-full text-left rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-accent/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-start gap-1 flex-1 min-w-0">
                <span className="font-medium text-sm line-clamp-2">
                  {campaign.name}
                </span>
                <NameEditButton
                  entityType="campaign"
                  entityId={campaign.id}
                  currentName={campaign.name}
                  accountId={accountId}
                  userId={userId}
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canToggle(campaign) && (
                  <div
                    onClick={(e) => handleToggleStatus(campaign, e)}
                    className="relative"
                  >
                    {togglingCampaignId === campaign.id ? (
                      <div className="w-9 h-5 flex items-center justify-center">
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Switch
                        checked={isActive(campaign)}
                        disabled={togglingCampaignId !== null}
                        aria-label="Alternar status"
                        className="scale-90"
                      />
                    )}
                  </div>
                )}
                <IssuesIcon entity={campaign} entityType="campaign" />
                <DeliveryStatus
                  status={campaign.effectiveStatus ?? campaign.status}
                  endTime={campaign.stopTime}
                  size="xs"
                />
                <DuplicateButton
                  entityType="campaign"
                  entityId={campaign.id}
                  entityName={campaign.name}
                  accountId={accountId}
                  userId={userId}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {getMobileMetrics(campaign).map(
                (metric) => (
                  <div key={metric.id}>
                    <span className="block text-xs font-semibold tabular-nums">
                      {formatMetricValue(metric, campaign.insights)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {getMetricLabel(metric.labelKey)}
                    </span>
                  </div>
                ),
              )}
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
                <TableHead className="min-w-[200px] text-xs">Campanha</TableHead>
                <TableHead className="w-[40px] text-xs" aria-label="Avisos" />
                <TableHead className="w-[130px] text-xs">Veiculação</TableHead>
                <TableHead className="text-xs" style={{ minWidth: desktopMetricsMinWidth }}>
                  Métricas principais
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-9" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                      <TableCell />
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
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
                : pagedCampaigns.map((campaign) => (
                    <TableRow
                      key={campaign.id}
                      className="cursor-pointer hover:bg-accent/40"
                      onClick={() => onCampaignClick(campaign)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(campaign) ? (
                          togglingCampaignId === campaign.id ? (
                            <div className="w-9 h-5 flex items-center justify-center">
                              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(campaign)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(campaign, e)}
                              disabled={togglingCampaignId !== null}
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
                          <span className="line-clamp-1">
                            {campaign.name}
                          </span>
                          <NameEditButton
                            entityType="campaign"
                            entityId={campaign.id}
                            currentName={campaign.name}
                            accountId={accountId}
                            userId={userId}
                          />
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IssuesIcon entity={campaign} entityType="campaign" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DeliveryStatus
                            status={
                              campaign.effectiveStatus ??
                              campaign.status ??
                              null
                            }
                            endTime={campaign.stopTime}
                          />
                          <DuplicateButton
                            entityType="campaign"
                            entityId={campaign.id}
                            entityName={campaign.name}
                            accountId={accountId}
                            userId={userId}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className="grid gap-3"
                          style={{
                            gridTemplateColumns: `repeat(${getDesktopMetrics(campaign).length}, minmax(0, 1fr))`,
                          }}
                        >
                          {getDesktopMetrics(campaign).map(
                            (metric) => (
                              <div key={metric.id} className="min-w-0">
                                <div className="tabular-nums text-sm font-medium">
                                  {formatMetricValue(metric, campaign.insights)}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {getMetricLabel(metric.labelKey)}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination (client-side over the fully-loaded set) */}
      {campaigns.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-1.5">
          <span className="mr-2 text-xs text-muted-foreground tabular-nums">
            {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, campaigns.length)} de{" "}
            {campaigns.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreviousPage}
            disabled={safePage <= 0 || isFetching}
            className="h-8 px-3 text-xs gap-1"
          >
            <ChevronLeft className="size-3.5" />
            Anterior
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNextPage}
            disabled={safePage >= totalPages - 1 || isFetching}
            className="h-8 px-3 text-xs gap-1"
          >
            Próxima
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
      {campaigns.length >= MAX_CAMPAIGNS && (
        <p className="text-right text-[11px] text-muted-foreground">
          Exibindo as primeiras {MAX_CAMPAIGNS} campanhas.
        </p>
      )}
    </div>
  );
}

function CampaignsTableSkeleton({ metricCount = 5 }: { metricCount?: number }) {
  const metricsGridStyle = {
    gridTemplateColumns: `repeat(${metricCount}, minmax(0, 1fr))`,
  };

  return (
    <div className="space-y-3">
      {/* Mobile Skeleton */}
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

      {/* Desktop Skeleton */}
      <div className="hidden sm:block rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-[60px] text-xs">Ativo</TableHead>
              <TableHead className="min-w-[200px] text-xs">Campanha</TableHead>
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
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-9" /></TableCell>
                <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                <TableCell />
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
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

