"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  getStatusBadgeVariant,
  translateStatus,
} from "../utils/formatters";

type GetCampaignsResponse = {
  data?: Campaign[];
  pagination?: PaginationInfo;
};

type CampaignsTableProps = {
  accountId: string;
  userId: string; // Required: identifies which user's token to use
  onCampaignClick: (campaign: Campaign) => void;
};

export function CampaignsTable({
  accountId,
  userId,
  onCampaignClick,
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
    [accountId, userId]
  );

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

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
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-destructive">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => fetchCampaigns(currentCursor)}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-muted-foreground">Nenhuma campanha encontrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-3">
        {campaigns.map((campaign) => (
          <button
            key={campaign.id}
            onClick={() => onCampaignClick(campaign)}
            className="w-full text-left rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-medium text-sm line-clamp-2">
                {campaign.name}
              </span>
              <div className="flex items-center gap-2">
                {canToggle(campaign) && (
                  <div
                    onClick={(e) => handleToggleStatus(campaign, e)}
                    className="relative"
                  >
                    {togglingCampaignId === campaign.id ? (
                      <div className="w-11 h-6 flex items-center justify-center">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Switch
                        checked={isActive(campaign)}
                        disabled={togglingCampaignId !== null}
                        aria-label="Alternar status"
                      />
                    )}
                  </div>
                )}
                <Badge variant={getStatusBadgeVariant(campaign.effectiveStatus)}>
                  {translateStatus(campaign.effectiveStatus ?? campaign.status)}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-foreground font-medium">
                  {formatCurrency(campaign.insights?.spend)}
                </span>
                <span>Gasto</span>
              </div>
              <div>
                <span className="block text-foreground font-medium">
                  {formatNumber(campaign.insights?.impressions)}
                </span>
                <span>Impressões</span>
              </div>
              <div>
                <span className="block text-foreground font-medium">
                  {formatNumber(campaign.insights?.clicks)}
                </span>
                <span>Cliques</span>
              </div>
              <div>
                <span className="block text-foreground font-medium">
                  {formatCurrency(campaign.insights?.cpc)}
                </span>
                <span>CPC</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Ativo</TableHead>
                <TableHead className="min-w-[200px]">Campanha</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[120px] text-right">Gasto</TableHead>
                <TableHead className="w-[120px] text-right">Impressões</TableHead>
                <TableHead className="w-[100px] text-right">Cliques</TableHead>
                <TableHead className="w-[100px] text-right">CPC</TableHead>
                <TableHead className="w-[100px] text-right">CPM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-6 w-11" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                : campaigns.map((campaign) => (
                    <TableRow
                      key={campaign.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => onCampaignClick(campaign)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(campaign) ? (
                          togglingCampaignId === campaign.id ? (
                            <div className="w-11 h-6 flex items-center justify-center">
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(campaign)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(campaign, e)}
                              disabled={togglingCampaignId !== null}
                              aria-label="Alternar status"
                            />
                          )
                        ) : (
                          <div className="w-11 h-6" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="line-clamp-1">{campaign.name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(
                            campaign.effectiveStatus
                          )}
                        >
                          {translateStatus(
                            campaign.effectiveStatus ?? campaign.status ?? "N/A"
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(campaign.insights?.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(campaign.insights?.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(campaign.insights?.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(campaign.insights?.cpc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(campaign.insights?.cpm)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && (pagination.hasNextPage || pagination.hasPreviousPage) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviousPage}
            disabled={!pagination.hasPreviousPage || isLoading}
          >
            <ChevronLeft className="size-4 mr-1" />
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!pagination.hasNextPage || isLoading}
          >
            Próxima
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function CampaignsTableSkeleton() {
  return (
    <div className="space-y-4">
      {/* Mobile Skeleton */}
      <div className="block sm:hidden space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-11" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-4 w-16 mb-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Skeleton */}
      <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Ativo</TableHead>
              <TableHead className="min-w-[200px]">Campanha</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[120px] text-right">Gasto</TableHead>
              <TableHead className="w-[120px] text-right">Impressões</TableHead>
              <TableHead className="w-[100px] text-right">Cliques</TableHead>
              <TableHead className="w-[100px] text-right">CPC</TableHead>
              <TableHead className="w-[100px] text-right">CPM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-6 w-11" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12 ml-auto" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
