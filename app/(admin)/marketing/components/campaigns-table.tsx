"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "../utils/formatters";
import {
  getCampaignMetricsForCampaign,
  getMetricRawValue,
  type CampaignMetricDefinition,
} from "../utils/campaign-metrics";
import { DeliveryStatus } from "./delivery-status";
import { IssuesIcon } from "./issues-icon";

type GetCampaignsResponse = {
  data?: Campaign[];
  pagination?: PaginationInfo;
};

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
};

function formatRoas(value: string | undefined): string {
  if (!value) return "-";

  const numValue = Number.parseFloat(value);
  if (Number.isNaN(numValue)) return "-";

  return `${numValue.toFixed(2)}x`;
}

function formatMetricValue(
  metric: CampaignMetricDefinition,
  campaign: Campaign,
): string {
  const rawValue = getMetricRawValue(campaign.insights, metric.id);

  switch (metric.format) {
    case "currency":
      return formatCurrency(rawValue);
    case "percentage":
      return formatPercentage(rawValue);
    case "roas":
      return formatRoas(rawValue);
    case "number":
    default:
      return formatNumber(rawValue);
  }
}

export function CampaignsTable({
  accountId,
  userId,
  onCampaignClick,
  refreshKey,
  datePreset,
  customRange,
}: CampaignsTableProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>();
  const [togglingCampaignId, setTogglingCampaignId] = useState<string | null>(
    null
  );

  const fetchCampaigns = useCallback(
    async (cursor?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const baseParams = new URLSearchParams({ limit: "25", userId });
        if (cursor) {
          baseParams.set("after", cursor);
        }
        // Forward the date filter so list-level metrics reflect the period
        // selected above the table. Custom range wins when both are set.
        if (customRange) {
          baseParams.set("since", customRange.since);
          baseParams.set("until", customRange.until);
        } else if (datePreset) {
          baseParams.set("datePreset", datePreset);
        }

        const activeParams = new URLSearchParams(baseParams);
        activeParams.set("effectiveStatus", "ACTIVE");

        const activeResponse = await fetch(
          `/api/meta-marketing/${accountId}/campaigns?${activeParams}`
        );

        if (!activeResponse.ok) {
          throw new Error("Falha ao buscar campanhas");
        }

        const activeData: GetCampaignsResponse = await activeResponse.json();

        const pausedParams = new URLSearchParams(baseParams);
        pausedParams.set("effectiveStatus", "PAUSED");

        const pausedResponse = await fetch(
          `/api/meta-marketing/${accountId}/campaigns?${pausedParams}`
        );

        if (!pausedResponse.ok) {
          throw new Error("Falha ao buscar campanhas");
        }

        const pausedData: GetCampaignsResponse = await pausedResponse.json();

        const combinedCampaigns = [
          ...(activeData.data ?? []),
          ...(pausedData.data ?? []),
        ];

        setCampaigns(combinedCampaigns);

        const combinedPagination: PaginationInfo = {
          hasNextPage:
            (activeData.pagination?.hasNextPage ?? false) ||
            (pausedData.pagination?.hasNextPage ?? false),
          hasPreviousPage:
            (activeData.pagination?.hasPreviousPage ?? false) ||
            (pausedData.pagination?.hasPreviousPage ?? false),
          nextCursor:
            activeData.pagination?.nextCursor ??
            pausedData.pagination?.nextCursor,
          previousCursor:
            activeData.pagination?.previousCursor ??
            pausedData.pagination?.previousCursor,
        };

        setPagination(combinedPagination);
      } catch (err) {
        console.error("Error fetching campaigns:", err);
        setError("Falha ao buscar campanhas");
      } finally {
        setIsLoading(false);
      }
    },
    [accountId, userId, datePreset, customRange]
  );

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns, refreshKey]);

  const handleToggleStatus = async (
    campaign: Campaign,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();

    if (togglingCampaignId) return;

    const newStatus =
      campaign.status === CampaignStatus.ACTIVE
        ? CampaignStatus.PAUSED
        : CampaignStatus.ACTIVE;

    const newEffectiveStatus =
      newStatus === CampaignStatus.ACTIVE
        ? EffectiveStatus.ACTIVE
        : EffectiveStatus.PAUSED;

    setTogglingCampaignId(campaign.id);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/campaigns?userId=${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            campaignId: campaign.id,
            status: newStatus,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Falha ao atualizar status");
      }

      setCampaigns((prevCampaigns) =>
        prevCampaigns.map((c) =>
          c.id === campaign.id
            ? {
                ...c,
                status: newStatus,
                effectiveStatus: newEffectiveStatus,
              }
            : c
        )
      );
    } catch (err) {
      console.error("Error toggling campaign status:", err);
    } finally {
      setTogglingCampaignId(null);
    }
  };

  const handleNextPage = () => {
    if (pagination?.nextCursor) {
      setCurrentCursor(pagination.nextCursor);
      fetchCampaigns(pagination.nextCursor);
    }
  };

  const handlePreviousPage = () => {
    if (pagination?.previousCursor) {
      setCurrentCursor(pagination.previousCursor);
      fetchCampaigns(pagination.previousCursor);
    }
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

  if (isLoading && campaigns.length === 0) {
    return <CampaignsTableSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchCampaigns(currentCursor)}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma campanha encontrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-2">
        {campaigns.map((campaign) => (
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
              <span className="font-medium text-sm line-clamp-2 flex-1">
                {campaign.name}
              </span>
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
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {getCampaignMetricsForCampaign(campaign, "mobileList").map(
                (metric) => (
                  <div key={metric.id}>
                    <span className="block text-xs font-semibold tabular-nums">
                      {formatMetricValue(metric, campaign)}
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
                <TableHead className="min-w-[420px] text-xs">Métricas principais</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-9" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                      <TableCell />
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell>
                        <div className="grid grid-cols-5 gap-3">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <div key={j}>
                              <Skeleton className="h-4 w-12 mb-1" />
                              <Skeleton className="h-3 w-16" />
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                : campaigns.map((campaign) => (
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
                        <span className="line-clamp-1">{campaign.name}</span>
                      </TableCell>
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IssuesIcon entity={campaign} entityType="campaign" />
                      </TableCell>
                      <TableCell>
                        <DeliveryStatus
                          status={
                            campaign.effectiveStatus ?? campaign.status ?? null
                          }
                          endTime={campaign.stopTime}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="grid grid-cols-5 gap-3">
                          {getCampaignMetricsForCampaign(campaign, "desktopList").map(
                            (metric) => (
                              <div key={metric.id} className="min-w-0">
                                <div className="tabular-nums text-sm font-medium">
                                  {formatMetricValue(metric, campaign)}
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

      {/* Pagination */}
      {pagination && (pagination.hasNextPage || pagination.hasPreviousPage) && (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreviousPage}
            disabled={!pagination.hasPreviousPage || isLoading}
            className="h-8 px-3 text-xs gap-1"
          >
            <ChevronLeft className="size-3.5" />
            Anterior
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNextPage}
            disabled={!pagination.hasNextPage || isLoading}
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

function CampaignsTableSkeleton() {
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
              <TableHead className="min-w-[420px] text-xs">Métricas principais</TableHead>
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
                  <div className="grid grid-cols-5 gap-3">
                    {Array.from({ length: 5 }).map((_, j) => (
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
