"use client";

import type { ReactNode } from "react";
import { Check, Download, Eye, Loader2, Play, Trash2 } from "lucide-react";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { formatMediaLibraryBytes } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { cn } from "@/lib/utils";

export type MediaLibraryGridProps = {
  items: MediaLibraryItem[];
  labels: MediaLibraryLabels;
  mode: "manage" | "select";
  uploaderDisplay: "badge" | "details";
  selectedUrls?: ReadonlySet<string>;
  multiple?: boolean;
  disableNewSelection?: boolean;
  busyIds?: ReadonlySet<string>;
  canDelete?: boolean;
  onToggle?: (item: MediaLibraryItem) => void;
  onPreview?: (item: MediaLibraryItem) => void;
  onDownload?: (item: MediaLibraryItem) => void;
  onDelete?: (item: MediaLibraryItem) => void;
  className?: string;
};

function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function uploaderText(item: MediaLibraryItem, labels: MediaLibraryLabels): string {
  return item.uploadedBy === "backoffice"
    ? (item.uploadedByBackofficeEmail ?? labels.teamBadge)
    : labels.uploadedByCustomer;
}

export function MediaLibraryGrid({
  items,
  labels,
  mode,
  uploaderDisplay,
  selectedUrls,
  multiple = true,
  disableNewSelection = false,
  busyIds,
  canDelete = true,
  onToggle,
  onPreview,
  onDownload,
  onDelete,
  className,
}: MediaLibraryGridProps) {
  return (
    <ul
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6", className)}
      data-testid="media-library-grid"
    >
      {items.map((item) => {
        const selected = selectedUrls?.has(item.url) ?? false;
        const busy = busyIds?.has(item.id) ?? false;
        const dimmed = mode === "select" && disableNewSelection && !selected;
        const handleMain = () => {
          if (mode === "select") {
            if (!dimmed) onToggle?.(item);
          } else {
            onPreview?.(item);
          }
        };
        return (
          <li key={item.id} className="flex min-w-0 flex-col gap-1.5" data-testid="media-library-item" data-media-id={item.id}>
            <div
              className={cn(
                "group relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition-colors",
                selected ? "border-primary" : "border-transparent hover:border-primary/30",
                dimmed && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={handleMain}
                disabled={dimmed}
                aria-pressed={mode === "select" ? selected : undefined}
                aria-label={mode === "select" ? labels.selectAria(item.filename) : labels.previewAria(item.filename)}
                className={cn("block size-full", dimmed ? "cursor-not-allowed" : "cursor-pointer")}
              >
                {item.isVideo ? (
                  <video src={`${item.url}#t=0.1`} className="size-full object-cover" muted playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.filename} loading="lazy" className="size-full object-cover" />
                )}
              </button>
              {item.isVideo ? (
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Play className="size-3" />
                  {labels.videoBadge}
                </span>
              ) : null}
              {mode === "select" && selected ? (
                <span
                  className={cn(
                    "pointer-events-none absolute right-1.5 top-1.5 flex size-5 items-center justify-center bg-primary text-primary-foreground shadow-sm",
                    multiple ? "rounded-full" : "rounded-md",
                  )}
                >
                  <Check className="size-3" />
                </span>
              ) : null}
              {busy ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </span>
              ) : null}
              {mode === "select" && canDelete && onDelete ? (
                <button
                  type="button"
                  aria-label={labels.deleteAria(item.filename)}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                  className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" title={item.filename}>
                {item.filename}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {labels.formatDate(item.createdAt)} · {formatMediaLibraryBytes(item.sizeBytes)}
              </p>
              {uploaderDisplay === "details" ? (
                <p className="truncate text-[11px] text-muted-foreground" title={uploaderText(item, labels)}>
                  {labels.uploadedByPrefix}: {uploaderText(item, labels)}
                </p>
              ) : item.uploadedBy === "backoffice" ? (
                <span className="mt-0.5 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {labels.teamBadge}
                </span>
              ) : null}
            </div>
            {mode === "manage" ? (
              <div className="flex items-center gap-1">
                <IconAction label={labels.previewAria(item.filename)} onClick={() => onPreview?.(item)} disabled={busy}>
                  <Eye className="size-3.5" />
                </IconAction>
                <IconAction label={labels.downloadAria(item.filename)} onClick={() => onDownload?.(item)} disabled={busy}>
                  <Download className="size-3.5" />
                </IconAction>
                {canDelete ? (
                  <IconAction label={labels.deleteAria(item.filename)} onClick={() => onDelete?.(item)} disabled={busy} destructive>
                    <Trash2 className="size-3.5" />
                  </IconAction>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
