"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
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
  AdStatus,
  EffectiveStatus,
  type Ad,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  getStatusBadgeVariant,
  translateStatus,
} from "../utils/formatters";

type GetAdsResponse = {
  data?: Ad[];
  pagination?: PaginationInfo;
};

type AdsTableProps = {
  accountId: string;
  userId: string;
  adSetId?: string;
  onAdClick?: (ad: Ad) => void;
};

export function AdsTable({
  accountId,
  userId,
  adSetId,
  onAdClick,
}: AdsTableProps) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>();
  const [togglingAdId, setTogglingAdId] = useState<string | null>(null);

  const fetchAds = useCallback(
    async (cursor?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ limit: "25", userId });
        if (cursor) {
          params.set("after", cursor);
        }
        if (adSetId) {
          params.set("adsetId", adSetId);
        }

        const response = await fetch(
          `/api/meta-marketing/${accountId}/ads?${params}`
        );

        if (!response.ok) {
          throw new Error("Falha ao buscar anúncios");
        }

        const data: GetAdsResponse = await response.json();
        setAds(data.data ?? []);
        setPagination(data.pagination ?? null);
      } catch (err) {
        console.error("Error fetching ads:", err);
        setError("Falha ao buscar anúncios");
      } finally {
        setIsLoading(false);
      }
    },
    [accountId, adSetId, userId]
  );

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  const handleNextPage = () => {
    if (pagination?.nextCursor) {
      setCurrentCursor(pagination.nextCursor);
      fetchAds(pagination.nextCursor);
    }
  };

  const handlePreviousPage = () => {
    if (pagination?.previousCursor) {
      setCurrentCursor(pagination.previousCursor);
      fetchAds(pagination.previousCursor);
    }
  };

  const handleToggleStatus = async (ad: Ad, event: React.MouseEvent) => {
    event.stopPropagation();

    if (togglingAdId) return;

    const newStatus =
      ad.status === AdStatus.ACTIVE ? AdStatus.PAUSED : AdStatus.ACTIVE;

    const newEffectiveStatus =
      newStatus === AdStatus.ACTIVE
        ? EffectiveStatus.ACTIVE
        : EffectiveStatus.PAUSED;

    setTogglingAdId(ad.id);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/ads?userId=${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            adId: ad.id,
            status: newStatus,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Falha ao atualizar status");
      }

      setAds((prevAds) =>
        prevAds.map((a) =>
          a.id === ad.id
            ? {
                ...a,
                status: newStatus,
                effectiveStatus: newEffectiveStatus,
              }
            : a
        )
      );
    } catch (err) {
      console.error("Error toggling ad status:", err);
    } finally {
      setTogglingAdId(null);
    }
  };

  const canToggle = (ad: Ad): boolean => {
    const status = ad.effectiveStatus ?? ad.status;
    return (
      status === EffectiveStatus.ACTIVE || status === EffectiveStatus.PAUSED
    );
  };

  const isActive = (ad: Ad): boolean => {
    return ad.status === AdStatus.ACTIVE;
  };

  if (isLoading && ads.length === 0) {
    return <AdsTableSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-destructive text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => fetchAds(currentCursor)}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-muted-foreground text-sm">Nenhum anúncio encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-2">
        {ads.map((ad) => (
          <button
            key={ad.id}
            onClick={() => onAdClick?.(ad)}
            className="w-full text-left rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
          >
            <div className="flex gap-3">
              <AdThumbnail ad={ad} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-medium text-sm line-clamp-2">
                    {ad.name}
                  </span>
                  <div className="flex items-center gap-2">
                    {canToggle(ad) && (
                      <div
                        onClick={(e) => handleToggleStatus(ad, e)}
                        className="relative"
                      >
                        {togglingAdId === ad.id ? (
                          <div className="w-11 h-6 flex items-center justify-center">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <Switch
                            checked={isActive(ad)}
                            disabled={togglingAdId !== null}
                            aria-label="Alternar status"
                          />
                        )}
                      </div>
                    )}
                    <Badge
                      variant={getStatusBadgeVariant(ad.effectiveStatus)}
                      className="text-xs shrink-0"
                    >
                      {translateStatus(ad.effectiveStatus ?? ad.status)}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="block text-foreground font-medium">
                      {formatCurrency(ad.insights?.spend)}
                    </span>
                    <span>Gasto</span>
                  </div>
                  <div>
                    <span className="block text-foreground font-medium">
                      {formatNumber(ad.insights?.clicks)}
                    </span>
                    <span>Cliques</span>
                  </div>
                </div>
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
                <TableHead className="w-[60px]">Preview</TableHead>
                <TableHead className="min-w-[150px]">Anúncio</TableHead>
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
                        <Skeleton className="h-10 w-10 rounded" />
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
                : ads.map((ad) => (
                    <TableRow
                      key={ad.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => onAdClick?.(ad)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(ad) ? (
                          togglingAdId === ad.id ? (
                            <div className="w-11 h-6 flex items-center justify-center">
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(ad)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(ad, e)}
                              disabled={togglingAdId !== null}
                              aria-label="Alternar status"
                            />
                          )
                        ) : (
                          <div className="w-11 h-6" />
                        )}
                      </TableCell>
                      <TableCell>
                        <AdThumbnail ad={ad} size="sm" />
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="line-clamp-1">{ad.name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(ad.effectiveStatus)}
                          className="text-xs"
                        >
                          {translateStatus(ad.effectiveStatus ?? ad.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(ad.insights?.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(ad.insights?.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(ad.insights?.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(ad.insights?.cpc)}
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

type AdThumbnailProps = {
  ad: Ad;
  size?: "sm" | "md" | "lg";
};

function AdThumbnail({ ad, size = "sm" }: AdThumbnailProps) {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    sm: "size-10",
    md: "size-16",
    lg: "size-24",
  };

  const imageUrl = ad.creative?.thumbnailUrl ?? ad.creative?.imageUrl;

  if (!imageUrl || imageError) {
    return (
      <div
        className={`${sizeClasses[size]} rounded border border-border bg-muted flex items-center justify-center shrink-0`}
      >
        <ImageOff className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded border border-border overflow-hidden shrink-0`}
    >
      <img
        src={imageUrl}
        alt={ad.name ?? "Ad preview"}
        className="size-full object-cover"
        onError={() => setImageError(true)}
      />
    </div>
  );
}

function AdsTableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="block sm:hidden space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3">
            <div className="flex gap-3">
              <Skeleton className="size-10 rounded shrink-0" />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-5 w-14" />
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
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Ativo</TableHead>
              <TableHead className="w-[60px]">Preview</TableHead>
              <TableHead className="min-w-[150px]">Anúncio</TableHead>
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
                  <Skeleton className="h-10 w-10 rounded" />
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
