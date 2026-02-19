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
  AdSetStatus,
  EffectiveStatus,
  type AdSet,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  getStatusBadgeVariant,
  translateStatus,
} from "../utils/formatters";

type GetAdSetsResponse = {
  data?: AdSet[];
  pagination?: PaginationInfo;
};

type AdSetsTableProps = {
  accountId: string;
  userId: string;
  campaignId?: string;
  onAdSetClick: (adSet: AdSet) => void;
};

export function AdSetsTable({
  accountId,
  userId,
  campaignId,
  onAdSetClick,
}: AdSetsTableProps) {
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>();
  const [togglingAdSetId, setTogglingAdSetId] = useState<string | null>(null);

  const fetchAdSets = useCallback(
    async (cursor?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const baseParams = new URLSearchParams({ limit: "25", userId });
        if (cursor) {
          baseParams.set("after", cursor);
        }
        if (campaignId) {
          baseParams.set("campaignId", campaignId);
        }

        const activeParams = new URLSearchParams(baseParams);
        activeParams.set("effectiveStatus", "ACTIVE");

        const activeResponse = await fetch(
          `/api/meta-marketing/${accountId}/adsets?${activeParams}`
        );

        if (!activeResponse.ok) {
          throw new Error("Falha ao buscar conjuntos de anúncios");
        }

        const activeData: GetAdSetsResponse = await activeResponse.json();

        const pausedParams = new URLSearchParams(baseParams);
        pausedParams.set("effectiveStatus", "PAUSED");

        const pausedResponse = await fetch(
          `/api/meta-marketing/${accountId}/adsets?${pausedParams}`
        );

        if (!pausedResponse.ok) {
          throw new Error("Falha ao buscar conjuntos de anúncios");
        }

        const pausedData: GetAdSetsResponse = await pausedResponse.json();

        const combinedAdSets = [
          ...(activeData.data ?? []),
          ...(pausedData.data ?? []),
        ];

        setAdSets(combinedAdSets);

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
        console.error("Error fetching ad sets:", err);
        setError("Falha ao buscar conjuntos de anúncios");
      } finally {
        setIsLoading(false);
      }
    },
    [accountId, campaignId, userId]
  );

  useEffect(() => {
    fetchAdSets();
  }, [fetchAdSets]);

  const handleToggleStatus = async (adSet: AdSet, event: React.MouseEvent) => {
    event.stopPropagation();

    if (togglingAdSetId) return;

    const newStatus =
      adSet.status === AdSetStatus.ACTIVE
        ? AdSetStatus.PAUSED
        : AdSetStatus.ACTIVE;

    const newEffectiveStatus =
      newStatus === AdSetStatus.ACTIVE
        ? EffectiveStatus.ACTIVE
        : EffectiveStatus.PAUSED;

    setTogglingAdSetId(adSet.id);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/adsets?userId=${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            adsetId: adSet.id,
            status: newStatus,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Falha ao atualizar status");
      }

      setAdSets((prevAdSets) =>
        prevAdSets.map((a) =>
          a.id === adSet.id
            ? {
                ...a,
                status: newStatus,
                effectiveStatus: newEffectiveStatus,
              }
            : a
        )
      );
    } catch (err) {
      console.error("Error toggling ad set status:", err);
    } finally {
      setTogglingAdSetId(null);
    }
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
      setCurrentCursor(pagination.nextCursor);
      fetchAdSets(pagination.nextCursor);
    }
  };

  const handlePreviousPage = () => {
    if (pagination?.previousCursor) {
      setCurrentCursor(pagination.previousCursor);
      fetchAdSets(pagination.previousCursor);
    }
  };

  if (isLoading && adSets.length === 0) {
    return <AdSetsTableSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-destructive text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => fetchAdSets(currentCursor)}
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
          <button
            key={adSet.id}
            onClick={() => onAdSetClick(adSet)}
            className="w-full text-left rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-medium text-sm line-clamp-2">
                {adSet.name}
              </span>
              <div className="flex items-center gap-2">
                {canToggle(adSet) && (
                  <div
                    onClick={(e) => handleToggleStatus(adSet, e)}
                    className="relative"
                  >
                    {togglingAdSetId === adSet.id ? (
                      <div className="w-11 h-6 flex items-center justify-center">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Switch
                        checked={isActive(adSet)}
                        disabled={togglingAdSetId !== null}
                        aria-label="Alternar status"
                      />
                    )}
                  </div>
                )}
                <Badge
                  variant={getStatusBadgeVariant(adSet.effectiveStatus)}
                  className="text-xs"
                >
                  {translateStatus(adSet.effectiveStatus ?? adSet.status)}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-foreground font-medium">
                  {formatCurrency(adSet.insights?.spend)}
                </span>
                <span>Gasto</span>
              </div>
              <div>
                <span className="block text-foreground font-medium">
                  {formatNumber(adSet.insights?.clicks)}
                </span>
                <span>Cliques</span>
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
                <TableHead className="min-w-[180px]">Conjunto de Anúncios</TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
                <TableHead className="w-[100px] text-right">Gasto</TableHead>
                <TableHead className="w-[100px] text-right">Impressões</TableHead>
                <TableHead className="w-[80px] text-right">Cliques</TableHead>
                <TableHead className="w-[80px] text-right">CPC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-6 w-11" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-14" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-14 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-14 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                : adSets.map((adSet) => (
                    <TableRow
                      key={adSet.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => onAdSetClick(adSet)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(adSet) ? (
                          togglingAdSetId === adSet.id ? (
                            <div className="w-11 h-6 flex items-center justify-center">
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(adSet)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(adSet, e)}
                              disabled={togglingAdSetId !== null}
                              aria-label="Alternar status"
                            />
                          )
                        ) : (
                          <div className="w-11 h-6" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="line-clamp-1">{adSet.name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(adSet.effectiveStatus)}
                          className="text-xs"
                        >
                          {translateStatus(
                            adSet.effectiveStatus ?? adSet.status ?? "N/A"
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(adSet.insights?.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(adSet.insights?.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(adSet.insights?.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(adSet.insights?.cpc)}
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

function AdSetsTableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="block sm:hidden space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-11" />
                <Skeleton className="h-5 w-14" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-4 w-14 mb-1" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Ativo</TableHead>
              <TableHead className="min-w-[180px]">Conjunto de Anúncios</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Gasto</TableHead>
              <TableHead className="w-[100px] text-right">Impressões</TableHead>
              <TableHead className="w-[80px] text-right">Cliques</TableHead>
              <TableHead className="w-[80px] text-right">CPC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-6 w-11" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-14" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-14 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-14 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-10 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-10 ml-auto" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
