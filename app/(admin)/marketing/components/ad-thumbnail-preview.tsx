"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ImageOff, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { Ad } from "@/lib/meta-business/types";
import type { AdMediaItem } from "@/lib/meta-business/ad-media-types";
import { prefetchAdMedia, useAdMedia } from "../hooks/use-ad-media";

const HOVER_OPEN_DELAY_MS = 280;
const HOVER_CLOSE_DELAY_MS = 180;

type AdThumbnailPreviewProps = {
  ad: Ad;
  accountId: string;
  userId: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
};

export function AdThumbnailPreview({
  ad,
  accountId,
  userId,
  size = "sm",
  onClick,
  disabled,
}: AdThumbnailPreviewProps) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [imageError, setImageError] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sizeClasses = {
    sm: "size-10",
    md: "size-16",
    lg: "size-24",
  };

  const thumbnailUrl = ad.creative?.thumbnailUrl ?? ad.creative?.imageUrl;
  const fallback = !thumbnailUrl || imageError;
  const interactive = !disabled && !!onClick;
  const hoverPreviewEnabled = interactive && !isMobile;

  const clearHoverTimers = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleHoverOpen = useCallback(() => {
    if (!hoverPreviewEnabled) return;

    clearHoverTimers();
    void prefetchAdMedia(queryClient, accountId, userId, ad.id);
    openTimeoutRef.current = setTimeout(() => {
      setHoverOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [
    accountId,
    ad.id,
    clearHoverTimers,
    hoverPreviewEnabled,
    queryClient,
    userId,
  ]);

  const scheduleHoverClose = useCallback(() => {
    clearHoverTimers();
    closeTimeoutRef.current = setTimeout(() => {
      setHoverOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimers]);

  const handlePointerEnter = useCallback(() => {
    scheduleHoverOpen();
  }, [scheduleHoverOpen]);

  const handlePointerLeave = useCallback(() => {
    scheduleHoverClose();
  }, [scheduleHoverClose]);

  const button = (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (hoverPreviewEnabled) {
          void prefetchAdMedia(queryClient, accountId, userId, ad.id);
        }
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
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onFocus={handlePointerEnter}
      onBlur={handlePointerLeave}
    >
      {fallback ? (
        <div className="size-full flex items-center justify-center">
          <ImageOff className="size-4 text-muted-foreground" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt={ad.name ?? "Ad preview"}
          className="size-full object-cover"
          onError={() => setImageError(true)}
        />
      )}
    </button>
  );

  if (!hoverPreviewEnabled) {
    return button;
  }

  return (
    <Popover open={hoverOpen} modal={false}>
      <PopoverAnchor asChild>{button}</PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-auto max-w-[min(22rem,calc(100vw-2rem))] p-2"
        onMouseEnter={handlePointerEnter}
        onMouseLeave={handlePointerLeave}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <AdMediaHoverPreview
          ad={ad}
          accountId={accountId}
          userId={userId}
          fallbackThumbnailUrl={thumbnailUrl}
        />
      </PopoverContent>
    </Popover>
  );
}

type AdMediaHoverPreviewProps = {
  ad: Ad;
  accountId: string;
  userId: string;
  fallbackThumbnailUrl?: string;
};

function AdMediaHoverPreview({
  ad,
  accountId,
  userId,
  fallbackThumbnailUrl,
}: AdMediaHoverPreviewProps) {
  const { data, isLoading, isError, error } = useAdMedia(
    accountId,
    userId,
    ad.id,
    true,
  );

  if (isLoading) {
    return (
      <div className="flex h-48 w-48 items-center justify-center rounded-md bg-muted/40">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-md bg-muted/40 px-3 text-center">
        {fallbackThumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fallbackThumbnailUrl}
            alt={ad.name ?? "Preview"}
            className="max-h-28 rounded object-contain opacity-80"
          />
        ) : (
          <AlertCircle className="size-5 text-destructive" />
        )}
        <p className="text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Falha ao carregar preview."}
        </p>
      </div>
    );
  }

  const item = data?.items[0];
  if (!item) {
    return (
      <div className="flex h-48 w-48 items-center justify-center rounded-md bg-muted/40 px-3 text-center text-xs text-muted-foreground">
        Nenhuma mídia disponível.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <HoverMediaSlide item={item} altText={ad.name ?? "Mídia do anúncio"} />
      {data && data.items.length > 1 ? (
        <p className="text-center text-[11px] text-muted-foreground">
          {data.items.length} mídias · clique para ver todas
        </p>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">
          Clique para abrir
        </p>
      )}
    </div>
  );
}

type HoverMediaSlideProps = {
  item: AdMediaItem;
  altText: string;
};

function HoverMediaSlide({ item, altText }: HoverMediaSlideProps) {
  if (item.kind === "image" && item.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.previewUrl}
        alt={altText}
        className="max-h-56 max-w-80 rounded-md object-contain"
      />
    );
  }

  if (item.videoStatus === "ready" && item.previewUrl) {
    return (
      <video
        src={item.previewUrl}
        poster={item.posterUrl}
        muted
        playsInline
        autoPlay
        loop
        className="max-h-56 max-w-80 rounded-md bg-black object-contain"
      />
    );
  }

  if (item.posterUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.posterUrl}
        alt={altText}
        className="max-h-56 max-w-80 rounded-md object-contain opacity-90"
      />
    );
  }

  return (
    <div className="flex h-48 w-48 items-center justify-center rounded-md bg-muted/40 px-3 text-center text-xs text-muted-foreground">
      Preview indisponível.
    </div>
  );
}
