"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { MediaLibraryDeleteDialog } from "@/components/media-library/media-library-delete-dialog";
import { MediaLibraryGrid } from "@/components/media-library/media-library-grid";
import { MediaLibraryUploadQueue } from "@/components/media-library/media-library-upload-queue";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Button } from "@/components/ui/button";
import { requestMediaLibraryDelete, type MediaLibraryEndpoints } from "@/lib/media-library/client";
import { useMediaLibrary, useMediaLibraryUpload } from "@/lib/media-library/hooks";
import {
  MEDIA_LIBRARY_ACCEPT_ATTRIBUTE,
  canBackofficeUpload,
  canCustomerUpload,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { cn } from "@/lib/utils";

export type MediaLibraryPanelProps = {
  endpoints: MediaLibraryEndpoints;
  labels: MediaLibraryLabels;
  actor: "customer" | "backoffice";
  uploaderDisplay: "badge" | "details";
  multiple: boolean;
  selectedUrls: ReadonlySet<string>;
  disableNewSelection: boolean;
  onToggle: (item: MediaLibraryItem) => void;
  onUploaded: (item: MediaLibraryItem) => void;
  onDeleted: (item: MediaLibraryItem) => void;
  className?: string;
};

/** Aba "Biblioteca" dos seletores: enviar no topo + grade da biblioteca em modo seleção. */
export function MediaLibraryPanel({
  endpoints,
  labels,
  actor,
  uploaderDisplay,
  multiple,
  selectedUrls,
  disableNewSelection,
  onToggle,
  onUploaded,
  onDeleted,
  className,
}: MediaLibraryPanelProps) {
  const library = useMediaLibrary({ endpoint: endpoints.list });
  const { prepend, removeLocal } = library;
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);
  const handleUploaded = useCallback(
    (item: MediaLibraryItem) => {
      prepend(item);
      onUploadedRef.current(item);
    },
    [prepend],
  );
  const upload = useMediaLibraryUpload({ endpoints, onUploaded: handleUploaded });
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const state = library.library?.state;
  const canUpload =
    state !== undefined && (actor === "customer" ? canCustomerUpload(state) : canBackofficeUpload(state));
  const canDelete = library.viewer ? library.viewer.canWrite : true;
  const hint =
    canUpload || state === undefined
      ? labels.uploadHint
      : state === "closed"
        ? labels.uploadDisabledClosed
        : labels.uploadDisabledSubscription;

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !canUpload) return;
    upload.enqueue(Array.from(files));
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(target.id, true);
    try {
      await requestMediaLibraryDelete(endpoints.item(target.id));
      removeLocal(target.id);
      onDeleted(target);
      toast.success(labels.deleteSuccess);
    } catch {
      toast.error(labels.deleteError);
    } finally {
      setBusy(target.id, false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)} data-testid="media-library-panel">
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-3"
        onDragOver={(event) => {
          if (canUpload) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
      >
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={!canUpload}>
          <UploadCloud className="size-4" />
          {labels.upload}
        </Button>
        <span className="text-[11px] text-muted-foreground" data-testid="media-library-upload-hint">
          {hint}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={MEDIA_LIBRARY_ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="media-library-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <MediaLibraryUploadQueue queue={upload.queue} labels={labels} onDismiss={upload.dismiss} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {library.status === "loading" ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {library.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">{labels.loadError}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void library.refresh()}>
              <RotateCcw className="size-3.5" />
              {labels.retry}
            </Button>
          </div>
        ) : null}
        {library.status === "ready" && library.items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <p className="text-sm font-medium">{labels.empty}</p>
            <p className="text-xs text-muted-foreground">{labels.emptyHint}</p>
          </div>
        ) : null}
        {library.status === "ready" && library.items.length > 0 ? (
          <div className="flex flex-col gap-3">
            <MediaLibraryGrid
              items={library.items}
              labels={labels}
              mode="select"
              uploaderDisplay={uploaderDisplay}
              selectedUrls={selectedUrls}
              multiple={multiple}
              disableNewSelection={disableNewSelection}
              busyIds={busyIds}
              canDelete={canDelete}
              onToggle={onToggle}
              onDelete={setPendingDelete}
            />
            {library.hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-center"
                onClick={() => void library.loadMore()}
                disabled={library.loadingMore}
              >
                {library.loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {labels.loadMore}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <MediaLibraryDeleteDialog
        item={pendingDelete}
        labels={labels}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
