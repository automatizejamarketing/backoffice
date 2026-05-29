"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAds, useToggleAdStatus } from "../hooks/marketing-queries";
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
import { cn } from "@/lib/utils";
import {
  AdStatus,
  DatePreset,
  EffectiveStatus,
  type Ad,
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
import { EditCreativeButton } from "./edit-creative-button";
import { IssuesIcon } from "./issues-icon";
import { NameEditButton } from "./name-edit-button";
import { PromotionLinkEditDialog } from "./promotion-link-edit-dialog";

type AdsTableProps = {
  accountId: string;
  userId: string;
  adSetId?: string;
  /**
   * Whether the parent ad set has Dynamic Creative enabled. Forwarded to the
   * per-row edit-creative button so the edit dialog matches the ad set mode.
   */
  adSetIsDynamic?: boolean;
  /**
   * Objective of the grandparent campaign. Drives the metric columns shown
   * in this table so an ad in a sales campaign exposes ROAS/CPA/etc. instead
   * of the generic spend/clicks fallback.
   */
  objective?: CampaignObjective;
  datePreset?: DatePreset | null;
  customRange?: { since: string; until: string } | null;
  selectedMetricIds?: CampaignMetricId[] | null;
  onAdClick?: (ad: Ad) => void;
  /** Disparado ao clicar na miniatura do anúncio. */
  onMediaClick?: (ad: Ad) => void;
};

export function AdsTable({
  accountId,
  userId,
  adSetId,
  adSetIsDynamic,
  objective,
  datePreset,
  customRange,
  selectedMetricIds,
  onAdClick,
  onMediaClick,
}: AdsTableProps) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [togglingAdId, setTogglingAdId] = useState<string | null>(null);

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
  const canEditPromotionLink =
    objective === "OUTCOME_SALES" || objective === "CONVERSIONS";

  const { data, isPending, isFetching, error, refetch } = useAds(
    accountId,
    userId,
    {
      adSetId: adSetId ?? null,
      datePreset,
      since: customRange?.since ?? null,
      until: customRange?.until ?? null,
      cursor: cursor ?? null,
    },
  );

  const ads = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  const isInitialLoading = isPending;

  const toggleStatus = useToggleAdStatus(accountId, userId);

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

  const handleToggleStatus = (ad: Ad, event: React.MouseEvent) => {
    event.stopPropagation();

    if (togglingAdId) return;

    const newStatus =
      ad.status === AdStatus.ACTIVE ? AdStatus.PAUSED : AdStatus.ACTIVE;

    setTogglingAdId(ad.id);
    toggleStatus.mutate(
      { adId: ad.id, nextStatus: newStatus },
      { onSettled: () => setTogglingAdId(null) },
    );
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

  if (isInitialLoading && ads.length === 0) {
    return <AdsTableSkeleton metricCount={desktopMetricCount} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-destructive text-sm">Falha ao buscar anúncios</p>
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
              <div onClick={(e) => e.stopPropagation()}>
                <AdThumbnailButton
                  ad={ad}
                  size="sm"
                  onClick={onMediaClick ? () => onMediaClick(ad) : undefined}
                  disabled={!onMediaClick}
                />
              </div>
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
                    <EditCreativeButton
                      accountId={accountId}
                      userId={userId}
                      ad={{ id: ad.id, name: ad.name }}
                      adSetIsDynamic={adSetIsDynamic}
                    />
                    {canEditPromotionLink && (
                      <PromotionLinkEditDialog
                        accountId={accountId}
                        userId={userId}
                        ad={{ id: ad.id, name: ad.name }}
                      />
                    )}
                    <DuplicateButton
                      entityType="ad"
                      entityId={ad.id}
                      entityName={ad.name}
                      accountId={accountId}
                      userId={userId}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {mobileMetrics.map((metric) => (
                    <div key={metric.id}>
                      <span className="block text-xs font-semibold tabular-nums">
                        {formatMetricValue(metric, ad.insights)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {getMetricLabel(metric.labelKey)}
                      </span>
                    </div>
                  ))}
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
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <AdThumbnailButton
                          ad={ad}
                          size="sm"
                          onClick={onMediaClick ? () => onMediaClick(ad) : undefined}
                          disabled={!onMediaClick}
                        />
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
                          />
                          {canEditPromotionLink && (
                            <PromotionLinkEditDialog
                              accountId={accountId}
                              userId={userId}
                              ad={{ id: ad.id, name: ad.name }}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-3" style={desktopMetricsGridStyle}>
                          {desktopMetrics.map((metric) => (
                            <div key={metric.id} className="min-w-0">
                              <div className="tabular-nums text-sm font-medium">
                                {formatMetricValue(metric, ad.insights)}
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

type AdThumbnailButtonProps = {
  ad: Ad;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
};

function AdThumbnailButton({
  ad,
  size = "sm",
  onClick,
  disabled,
}: AdThumbnailButtonProps) {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    sm: "size-10",
    md: "size-16",
    lg: "size-24",
  };

  const imageUrl = ad.creative?.thumbnailUrl ?? ad.creative?.imageUrl;
  const fallback = !imageUrl || imageError;
  const interactive = !disabled && !!onClick;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled}
      aria-label={
        interactive
          ? `Ver mídia do anúncio ${ad.name ?? ""}`.trim()
          : undefined
      }
      className={cn(
        sizeClasses[size],
        "rounded border border-border overflow-hidden shrink-0 relative p-0 bg-muted",
        interactive
          ? "cursor-pointer transition-all hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          : "cursor-default",
      )}
    >
      {fallback ? (
        <div className="size-full flex items-center justify-center">
          <ImageOff className="size-4 text-muted-foreground" />
        </div>
      ) : (
        <img
          src={imageUrl}
          alt={ad.name ?? "Ad preview"}
          className="size-full object-cover"
          onError={() => setImageError(true)}
        />
      )}
    </button>
  );
}

function AdsTableSkeleton({ metricCount = 5 }: { metricCount?: number }) {
  const metricsGridStyle = {
    gridTemplateColumns: `repeat(${metricCount}, minmax(0, 1fr))`,
  };

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
                  {Array.from({ length: 4 }).map((_, j) => (
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
