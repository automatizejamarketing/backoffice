"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
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
  AdStatus,
  EffectiveStatus,
  type Ad,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import { formatCurrency, formatNumber } from "../utils/formatters";
import { DeliveryStatus } from "./delivery-status";
import { DuplicateButton } from "./duplicate-button";
import { IssuesIcon } from "./issues-icon";
import { NameEditButton } from "./name-edit-button";

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
          <div
            key={ad.id}
            role="button"
            tabIndex={0}
            onClick={() => onAdClick?.(ad)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdClick?.(ad);
              }
            }}
            className="w-full cursor-pointer text-left rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex gap-3">
              <AdThumbnail ad={ad} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-start gap-1 flex-1 min-w-0">
                    <span className="font-medium text-sm line-clamp-2">
                      {ad.name}
                    </span>
                    <NameEditButton
                      entityType="ad"
                      entityId={ad.id}
                      currentName={ad.name}
                      accountId={accountId}
                      userId={userId}
                      onRenamed={(newName) =>
                        setAds((prev) =>
                          prev.map((a) =>
                            a.id === ad.id ? { ...a, name: newName } : a,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {canToggle(ad) && (
                      <div
                        onClick={(e) => handleToggleStatus(ad, e)}
                        className="relative"
                      >
                        {togglingAdId === ad.id ? (
                          <div className="w-9 h-5 flex items-center justify-center">
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <Switch
                            checked={isActive(ad)}
                            disabled={togglingAdId !== null}
                            aria-label="Alternar status"
                            className="scale-90"
                          />
                        )}
                      </div>
                    )}
                    <IssuesIcon entity={ad} entityType="ad" />
                    <DeliveryStatus
                      status={ad.effectiveStatus ?? ad.status}
                      size="xs"
                      className="shrink-0"
                    />
                    <DuplicateButton
                      entityType="ad"
                      entityId={ad.id}
                      entityName={ad.name}
                      accountId={accountId}
                      userId={userId}
                      onDuplicated={() => fetchAds(currentCursor)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div>
                    <span className="block text-xs font-semibold tabular-nums">
                      {formatCurrency(ad.insights?.spend)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Gasto</span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold tabular-nums">
                      {formatNumber(ad.insights?.clicks)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Cliques</span>
                  </div>
                </div>
              </div>
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
                <TableHead className="w-[60px] text-xs">Preview</TableHead>
                <TableHead className="min-w-[150px] text-xs">Anúncio</TableHead>
                <TableHead className="w-[40px] text-xs" aria-label="Avisos" />
                <TableHead className="w-[130px] text-xs">Veiculação</TableHead>
                <TableHead className="w-[100px] text-right text-xs">Gasto</TableHead>
                <TableHead className="w-[100px] text-right text-xs">Impressões</TableHead>
                <TableHead className="w-[80px] text-right text-xs">Cliques</TableHead>
                <TableHead className="w-[80px] text-right text-xs">CPC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-9" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-10 w-10 rounded" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
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
                      className="cursor-pointer hover:bg-accent/40"
                      onClick={() => onAdClick?.(ad)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canToggle(ad) ? (
                          togglingAdId === ad.id ? (
                            <div className="w-9 h-5 flex items-center justify-center">
                              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <Switch
                              checked={isActive(ad)}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleToggleStatus(ad, e)}
                              disabled={togglingAdId !== null}
                              aria-label="Alternar status"
                              className="scale-90"
                            />
                          )
                        ) : (
                          <div className="w-9 h-5" />
                        )}
                      </TableCell>
                      <TableCell>
                        <AdThumbnail ad={ad} size="sm" />
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="line-clamp-1">{ad.name}</span>
                          <NameEditButton
                            entityType="ad"
                            entityId={ad.id}
                            currentName={ad.name}
                            accountId={accountId}
                            userId={userId}
                            onRenamed={(newName) =>
                              setAds((prev) =>
                                prev.map((a) =>
                                  a.id === ad.id
                                    ? { ...a, name: newName }
                                    : a,
                                ),
                              )
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IssuesIcon entity={ad} entityType="ad" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DeliveryStatus
                            status={ad.effectiveStatus ?? ad.status ?? null}
                          />
                          <DuplicateButton
                            entityType="ad"
                            entityId={ad.id}
                            entityName={ad.name}
                            accountId={accountId}
                            userId={userId}
                            onDuplicated={() => fetchAds(currentCursor)}
                          />
                        </div>
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
          <div key={i} className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex gap-3">
              <Skeleton className="size-10 rounded shrink-0" />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-14" />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j}>
                      <Skeleton className="h-3.5 w-14 mb-1" />
                      <Skeleton className="h-2.5 w-10" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-[60px] text-xs">Ativo</TableHead>
              <TableHead className="w-[60px] text-xs">Preview</TableHead>
              <TableHead className="min-w-[150px] text-xs">Anúncio</TableHead>
              <TableHead className="w-[40px] text-xs" aria-label="Avisos" />
              <TableHead className="w-[130px] text-xs">Veiculação</TableHead>
              <TableHead className="w-[100px] text-right text-xs">Gasto</TableHead>
              <TableHead className="w-[100px] text-right text-xs">Impressões</TableHead>
              <TableHead className="w-[80px] text-right text-xs">Cliques</TableHead>
              <TableHead className="w-[80px] text-right text-xs">CPC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-5 w-9" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-10 w-10 rounded" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell />
                <TableCell>
                  <Skeleton className="h-4 w-20" />
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
