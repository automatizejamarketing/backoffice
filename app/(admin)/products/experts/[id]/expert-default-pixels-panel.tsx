"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TrackingPixel } from "@/lib/products/tracking-pixels";
import {
  fromTrackingPixelDrafts,
  toTrackingPixelDrafts,
  TrackingPixelsEditor,
} from "../../tracking-pixels-editor";

export function ExpertDefaultPixelsPanel({
  expertId,
  initialPixels,
  initialCapiPixelIds,
}: {
  expertId: string;
  initialPixels: TrackingPixel[];
  initialCapiPixelIds: string[];
}) {
  const router = useRouter();
  const [pixels, setPixels] = useState(() =>
    toTrackingPixelDrafts(initialPixels),
  );
  const [capiPixelIds, setCapiPixelIds] = useState(initialCapiPixelIds);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(
        `/api/products/admin/experts/${expertId}/tracking-pixels`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackingPixels: fromTrackingPixelDrafts(pixels),
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        defaults?: TrackingPixel[];
        updatedProducts?: number;
        capiPixelIds?: string[];
      } | null;
      if (!response.ok || !body?.defaults) {
        throw new Error(body?.error ?? "Não foi possível salvar os pixels.");
      }
      setPixels(toTrackingPixelDrafts(body.defaults));
      setCapiPixelIds(body.capiPixelIds ?? capiPixelIds);
      const updated = body.updatedProducts ?? 0;
      toast.success(
        updated === 0
          ? "Pixels padrão salvos."
          : `Pixels padrão salvos e aplicados a ${updated} ${updated === 1 ? "produto" : "produtos"}.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os pixels.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <TrackingPixelsEditor
        idPrefix="expert-page-pixel"
        value={pixels}
        onChange={setPixels}
        capiPixelIds={capiPixelIds}
        disabled={saving}
      />
      <Button type="button" onClick={save} disabled={saving}>
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        {saving ? "Salvando..." : "Salvar pixels padrão"}
      </Button>
    </div>
  );
}
