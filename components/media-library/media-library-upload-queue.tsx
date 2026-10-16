"use client";

import { X } from "lucide-react";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Progress } from "@/components/ui/progress";
import type { MediaLibraryUploadQueueItem } from "@/lib/media-library/hooks";
import { cn } from "@/lib/utils";

export function MediaLibraryUploadQueue({
  queue,
  labels,
  onDismiss,
}: {
  queue: MediaLibraryUploadQueueItem[];
  labels: MediaLibraryLabels;
  onDismiss: (id: string) => void;
}) {
  if (queue.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="media-library-upload-queue">
      {queue.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
          data-status={entry.status}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium">{entry.name}</p>
              <span className={cn("shrink-0 text-[11px]", entry.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                {entry.status === "uploading"
                  ? `${labels.uploading} ${entry.progress}%`
                  : entry.status === "done"
                    ? labels.uploaded
                    : labels.errorMessage(entry.errorCode ?? "upload_failed")}
              </span>
            </div>
            {entry.status !== "error" ? <Progress value={entry.progress} className="mt-1.5 h-1.5" /> : null}
          </div>
          {entry.status === "error" ? (
            <button
              type="button"
              aria-label={labels.dismiss}
              onClick={() => onDismiss(entry.id)}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
