"use client";

import type { MediaLibraryLabels } from "@/components/media-library/labels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { MediaLibraryItem } from "@/lib/media-library/service";

export function MediaLibraryDeleteDialog({
  item,
  labels,
  onCancel,
  onConfirm,
}: {
  item: MediaLibraryItem | null;
  labels: MediaLibraryLabels;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={item !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{item ? labels.deleteDescription(item.filename) : ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.deleteCancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {labels.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
