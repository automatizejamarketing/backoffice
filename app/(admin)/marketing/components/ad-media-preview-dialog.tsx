"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { Ad } from "@/lib/meta-business/types";
import type {
  AdMediaItem,
  AdMediaLayout,
  GetAdMediaResponse,
} from "@/lib/meta-business/ad-media-types";

type AdMediaPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  userId: string;
  ad: Ad | null;
};

export function AdMediaPreviewDialog({
  open,
  onOpenChange,
  accountId,
  userId,
  ad,
}: AdMediaPreviewDialogProps) {
  const isMobile = useIsMobile();

  const content =
    open && ad ? (
      <AdMediaContent ad={ad} accountId={accountId} userId={userId} />
    ) : null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetTitle className="sr-only">Mídia do anúncio</SheetTitle>
          <div className="mt-4">{content}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Mídia do anúncio</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  );
}

type AdMediaContentProps = {
  ad: Ad;
  accountId: string;
  userId: string;
};

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; items: AdMediaItem[]; layout: AdMediaLayout }
  | { phase: "error"; message: string };

function AdMediaContent({ ad, accountId, userId }: AdMediaContentProps) {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ac = new AbortController();

    fetch(
      `/api/meta-marketing/${accountId}/ads/${ad.id}/media?userId=${encodeURIComponent(userId)}`,
      { signal: ac.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? "Falha ao carregar mídia.");
        }
        return res.json() as Promise<GetAdMediaResponse>;
      })
      .then((data) => {
        if (ac.signal.aborted) return;
        setLoadState({
          phase: "ready",
          items: data.items,
          layout: data.layout,
        });
        setCurrentIndex(0);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Falha ao carregar mídia.";
        console.error("Error fetching ad media:", err);
        setLoadState({ phase: "error", message });
      });

    return () => ac.abort();
  }, [ad.id, accountId, userId, reloadKey]);

  const items = loadState.phase === "ready" ? loadState.items : [];
  const layout = loadState.phase === "ready" ? loadState.layout : "unknown";
  const hasMultiple = items.length > 1;
  const current = items[currentIndex];

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(items.length - 1, i + 1));
  }, [items.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  const handleDownload = () => {
    if (!current?.downloadUrl) return;
    const a = document.createElement("a");
    a.href = current.downloadUrl;
    a.download = current.downloadFilename ?? "midia";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRetry = () => {
    setLoadState({ phase: "loading" });
    setReloadKey((k) => k + 1);
  };

  return (
    <div
      className="flex flex-col gap-4 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {loadState.phase === "loading" ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadState.phase === "error" ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm text-destructive">{loadState.message}</p>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : items.length === 0 || !current ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma mídia disponível para este anúncio.
        </div>
      ) : (
        <>
          <div className="relative flex items-center justify-center bg-muted/30 rounded-md min-h-[40vh]">
            {hasMultiple && (
              <Button
                variant="ghost"
                size="icon"
                onClick={goPrev}
                disabled={currentIndex === 0}
                aria-label="Mídia anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background"
              >
                <ChevronLeft className="size-5" />
              </Button>
            )}

            <MediaSlide item={current} altText={ad.name ?? "Mídia do anúncio"} />

            {hasMultiple && (
              <Button
                variant="ghost"
                size="icon"
                onClick={goNext}
                disabled={currentIndex === items.length - 1}
                aria-label="Próxima mídia"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background"
              >
                <ChevronRight className="size-5" />
              </Button>
            )}
          </div>

          {hasMultiple && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground text-center">
                {currentIndex + 1} / {items.length}
                {layout === "carousel" && " · Carrossel"}
                {layout === "dynamic" && " · Criativo dinâmico"}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {items.map((it, idx) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={cn(
                      "shrink-0 size-14 rounded border overflow-hidden bg-muted relative",
                      idx === currentIndex
                        ? "ring-2 ring-primary border-primary"
                        : "border-border hover:border-primary/50",
                    )}
                    aria-label={`Mídia ${idx + 1}`}
                  >
                    {it.posterUrl || it.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.posterUrl ?? it.previewUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full flex items-center justify-center text-[10px] text-muted-foreground">
                        Vídeo
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleDownload}
              disabled={!current.downloadUrl}
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 size-4" />
              Baixar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type MediaSlideProps = {
  item: AdMediaItem;
  altText: string;
};

function MediaSlide({ item, altText }: MediaSlideProps) {
  if (item.kind === "image") {
    if (!item.previewUrl) {
      return (
        <div className="py-8 text-sm text-muted-foreground">
          Imagem indisponível.
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.previewUrl}
        alt={altText}
        className="max-h-[60vh] w-auto object-contain rounded-md"
      />
    );
  }

  if (item.videoStatus === "ready" && item.previewUrl) {
    return (
      <video
        key={item.key}
        src={item.previewUrl}
        poster={item.posterUrl}
        controls
        playsInline
        className="max-h-[60vh] w-auto rounded-md bg-black"
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6 px-4 text-center">
      {item.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt={altText}
          className="max-h-[40vh] rounded-md opacity-70"
        />
      )}
      <p className="text-sm text-muted-foreground max-w-md">
        {item.videoStatus === "processing"
          ? "O vídeo ainda está sendo processado pela Meta. Tente novamente em alguns instantes."
          : item.videoErrorMessage ?? "Não foi possível processar este vídeo."}
      </p>
    </div>
  );
}
