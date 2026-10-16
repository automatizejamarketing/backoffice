"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { MediaLibraryDeleteDialog } from "@/components/media-library/media-library-delete-dialog";
import { MediaLibraryGrid } from "@/components/media-library/media-library-grid";
import { MediaLibraryUploadQueue } from "@/components/media-library/media-library-upload-queue";
import { MediaPreviewDialog } from "@/components/media-library/media-preview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  backofficeMediaLibraryEndpoints,
  requestMediaLibraryDelete,
  requestMediaLibraryDownload,
} from "@/lib/media-library/client";
import { useMediaLibrary, useMediaLibraryUpload } from "@/lib/media-library/hooks";
import { MEDIA_LIBRARY_ACCEPT_ATTRIBUTE, canBackofficeUpload } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { BACKOFFICE_MEDIA_LIBRARY_LABELS, describeMediaLibraryState } from "./media-library-state";

/** 2 linhas na largura de desktop (grade de 6 colunas). */
const COMPACT_COUNT = 12;

export function MediaLibraryCard({ userId }: { userId: string }) {
  const labels = BACKOFFICE_MEDIA_LIBRARY_LABELS;
  const endpoints = useMemo(() => backofficeMediaLibraryEndpoints(userId), [userId]);
  const library = useMediaLibrary({ endpoint: endpoints.list });
  const upload = useMediaLibraryUpload({ endpoints, onUploaded: library.prepend });
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<MediaLibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const summary = library.library;
  const canWrite = library.viewer?.canWrite ?? false;
  const canAdd = canWrite && summary !== null && canBackofficeUpload(summary.state);
  // "Encerrada" só é afirmado com o estado conhecido: enquanto carrega (ou se a
  // primeira carga falhar) o botão fica desativado sem dizer por que.
  const closed = summary?.state === "closed";
  const visibleItems = expanded ? library.items : library.items.slice(0, COMPACT_COUNT);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleDownload = useCallback(
    async (item: MediaLibraryItem) => {
      setBusy(item.id, true);
      try {
        await requestMediaLibraryDownload(endpoints.download(item.id));
      } catch {
        toast.error(labels.downloadError);
      } finally {
        setBusy(item.id, false);
      }
    },
    [endpoints, labels.downloadError],
  );

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(target.id, true);
    try {
      await requestMediaLibraryDelete(endpoints.item(target.id));
      library.removeLocal(target.id);
      if (preview?.id === target.id) setPreview(null);
      toast.success(labels.deleteSuccess);
    } catch {
      toast.error(labels.deleteError);
    } finally {
      setBusy(target.id, false);
    }
  };

  return (
    <Card data-testid="media-library-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Biblioteca de mídias
              {library.status === "ready" ? <Badge variant="secondary">{library.total}</Badge> : null}
            </CardTitle>
            {summary ? (
              <p className="text-xs text-muted-foreground" data-testid="media-library-state">
                {describeMediaLibraryState(summary)}
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={!canAdd}
                title={closed ? labels.uploadDisabledClosed : undefined}
              >
                <UploadCloud className="size-4" />
                {labels.upload}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {closed ? labels.uploadDisabledClosed : labels.uploadHint}
              </span>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={MEDIA_LIBRARY_ACCEPT_ATTRIBUTE}
                className="hidden"
                data-testid="media-library-input"
                onChange={(event) => {
                  if (event.target.files && canAdd) upload.enqueue(Array.from(event.target.files));
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <MediaLibraryUploadQueue queue={upload.queue} labels={labels} onDismiss={upload.dismiss} />
        {library.status === "loading" ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {library.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">{labels.loadError}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void library.refresh()}>
              <RotateCcw className="size-3.5" />
              {labels.retry}
            </Button>
          </div>
        ) : null}
        {library.status === "ready" && summary?.state === "closed" ? (
          <p className="text-sm text-muted-foreground">
            O acesso do cliente está encerrado (expirou há mais de 1 mês ou nunca foi ativado): as mídias foram (ou
            serão, na próxima limpeza diária) apagadas e nada pode ser adicionado.
          </p>
        ) : null}
        {library.status === "ready" && summary?.state !== "closed" && library.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.empty}.</p>
        ) : null}
        {library.status === "ready" && library.items.length > 0 ? (
          <MediaLibraryGrid
            items={visibleItems}
            labels={labels}
            mode="manage"
            uploaderDisplay="details"
            busyIds={busyIds}
            canDelete={canWrite}
            onPreview={setPreview}
            onDownload={(item) => void handleDownload(item)}
            onDelete={setPendingDelete}
          />
        ) : null}
        {library.status === "ready" && !expanded && library.total > COMPACT_COUNT ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Ver todas ({library.total})
          </Button>
        ) : null}
        {expanded && library.hasMore ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void library.loadMore()} disabled={library.loadingMore}>
            {library.loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {labels.loadMore}
          </Button>
        ) : null}
      </CardContent>
      <MediaPreviewDialog
        item={preview}
        labels={labels}
        uploaderDisplay="details"
        onClose={() => setPreview(null)}
        onDownload={(item) => void handleDownload(item)}
      />
      <MediaLibraryDeleteDialog
        item={pendingDelete}
        labels={labels}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
