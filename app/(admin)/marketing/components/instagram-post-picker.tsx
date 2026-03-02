"use client";

import { useState, useCallback, useEffect } from "react";
import { Check, Heart, ImageIcon, Loader2, MessageCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InstagramMediaItem = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

type InstagramPostPickerProps = {
  accountId: string;
  userId: string;
  selectedPost: InstagramMediaItem | null;
  onSelect: (post: InstagramMediaItem | null) => void;
};

function formatCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export function InstagramPostPicker({
  accountId,
  userId,
  selectedPost,
  onSelect,
}: InstagramPostPickerProps) {
  const [media, setMedia] = useState<InstagramMediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMedia = useCallback(
    async (cursor?: string) => {
      const isFirst = !cursor;
      if (isFirst) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const queryParams = new URLSearchParams({
          userId,
          limit: "12",
        });
        if (cursor) {
          queryParams.set("after", cursor);
        }

        const response = await fetch(
          `/api/meta-marketing/${accountId}/instagram/user-media?${queryParams}`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message ?? "Falha ao buscar posts do Instagram",
          );
        }

        const data = await response.json();

        if (isFirst) {
          setMedia(data.media ?? []);
        } else {
          setMedia((prev) => [...prev, ...(data.media ?? [])]);
        }

        setNextCursor(data.pagination?.nextCursor);
        setHasNextPage(data.pagination?.hasNextPage ?? false);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Falha ao buscar posts do Instagram",
        );
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [accountId, userId],
  );

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <p className="text-sm text-muted-foreground text-center">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchMedia()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <ImageIcon className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Nenhum post encontrado</p>
        <p className="text-xs text-muted-foreground text-center">
          Nenhum post disponível na conta do Instagram conectada
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {media.map((item) => {
          const isSelected = selectedPost?.id === item.id;
          const isVideo =
            item.media_type === "VIDEO" || item.media_type === "REELS";
          const imageUrl = item.thumbnail_url ?? item.media_url;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : item)}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-md border-2 transition-all",
                isSelected
                  ? "border-primary"
                  : "border-transparent hover:border-primary/30",
              )}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={item.caption ?? "Instagram post"}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex size-full items-center justify-center bg-muted">
                  <ImageIcon className="size-6 text-muted-foreground" />
                </div>
              )}

              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary shadow">
                  <Check className="size-3 text-primary-foreground" />
                </div>
              )}

              {/* Video indicator */}
              {isVideo && (
                <div
                  className={cn(
                    "absolute rounded-full bg-black/60 p-1",
                    isSelected ? "right-1.5 top-8" : "right-1.5 top-1.5",
                  )}
                >
                  <Play className="size-2.5 fill-white text-white" />
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                <div className="flex items-center gap-3 text-white text-xs">
                  {item.like_count !== undefined && (
                    <span className="flex items-center gap-0.5">
                      <Heart className="size-3.5 fill-white" />
                      {formatCount(item.like_count)}
                    </span>
                  )}
                  {item.comments_count !== undefined && (
                    <span className="flex items-center gap-0.5">
                      <MessageCircle className="size-3.5 fill-white" />
                      {formatCount(item.comments_count)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isLoadingMore}
          onClick={() => fetchMedia(nextCursor)}
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Carregando...
            </>
          ) : (
            "Carregar mais"
          )}
        </Button>
      )}
    </div>
  );
}
