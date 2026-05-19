"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AutomatizeMediaSelection = {
  generatedImageId: string;
  imageUrl: string;
};

type AutomatizeMediaItem = {
  id: string;
  imageUrl: string;
  prompt: string | null;
  aspectRatio: string | null;
  createdAt: string;
};

type AutomatizeMediaGridProps = {
  accountId: string;
  userId: string;
  selected: AutomatizeMediaSelection | null;
  onSelect: (selection: AutomatizeMediaSelection | null) => void;
};

export function AutomatizeMediaGrid({
  accountId,
  userId,
  selected,
  onSelect,
}: AutomatizeMediaGridProps) {
  const [media, setMedia] = useState<AutomatizeMediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMedia = useCallback(
    async (nextPage: number) => {
      const isFirst = nextPage === 1;
      if (isFirst) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const params = new URLSearchParams({
          userId,
          page: String(nextPage),
          limit: "24",
        });
        const response = await fetch(
          `/api/meta-marketing/${accountId}/automatize-media?${params}`,
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message ?? "Falha ao carregar mídias");
        }
        const data = await response.json();
        setMedia((prev) =>
          isFirst ? (data.media ?? []) : [...prev, ...(data.media ?? [])],
        );
        setTotal(data.total ?? 0);
        setPage(nextPage);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Falha ao carregar mídias",
        );
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [accountId, userId],
  );

  useEffect(() => {
    fetchMedia(1);
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
        <p className="text-center text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchMedia(1)}>
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
        <p className="text-sm font-medium">Nenhuma mídia encontrada</p>
        <p className="text-center text-xs text-muted-foreground">
          Este usuário ainda não tem imagens geradas no Automatize.
        </p>
      </div>
    );
  }

  const hasMore = media.length < total;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {media.map((item) => {
          const isSelected = selected?.generatedImageId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                onSelect(
                  isSelected
                    ? null
                    : { generatedImageId: item.id, imageUrl: item.imageUrl },
                )
              }
              className={cn(
                "group relative aspect-square overflow-hidden rounded-md border-2 transition-all",
                isSelected
                  ? "border-primary"
                  : "border-transparent hover:border-primary/30",
              )}
            >
              <img
                src={item.imageUrl}
                alt={item.prompt ?? "Mídia do Automatize"}
                className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {isSelected && (
                <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary shadow">
                  <Check className="size-3 text-primary-foreground" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isLoadingMore}
          onClick={() => fetchMedia(page + 1)}
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
