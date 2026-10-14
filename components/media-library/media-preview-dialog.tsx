"use client";

import { Download } from "lucide-react";
import { uploaderText } from "@/components/media-library/media-library-grid";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMediaLibraryBytes } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";

export function MediaPreviewDialog({
  item,
  labels,
  uploaderDisplay,
  onClose,
  onDownload,
}: {
  item: MediaLibraryItem | null;
  labels: MediaLibraryLabels;
  uploaderDisplay: "badge" | "details";
  onClose: () => void;
  onDownload: (item: MediaLibraryItem) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{item.filename}</DialogTitle>
              <DialogDescription>
                {labels.formatDate(item.createdAt)} · {formatMediaLibraryBytes(item.sizeBytes)}
                {uploaderDisplay === "details" ? ` · ${labels.uploadedByPrefix}: ${uploaderText(item, labels)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg bg-muted">
              {item.isVideo ? (
                <video src={item.url} controls playsInline className="max-h-[70vh] w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.filename} className="max-h-[70vh] w-auto object-contain" />
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onDownload(item)}>
                <Download className="size-4" />
                {labels.download}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
