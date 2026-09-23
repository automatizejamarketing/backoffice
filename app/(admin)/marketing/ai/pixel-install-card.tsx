"use client";

import { Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  flowCardClassName,
  flowCardTitleClassName,
  flowMonoCaptionClassName,
  flowWarningClassName,
} from "./flow-chrome";
import { buildPixelBaseCode } from "./pixel-step";

/**
 * Shown while the selected pixel is the one just created: it has no code on the client's site
 * yet, so the campaign publishes but measures no sale until someone installs it.
 */
export function PixelInstallCard({ pixelId }: { pixelId: string }) {
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(buildPixelBaseCode(pixelId));
      toast.success("Código do pixel copiado.");
    } catch {
      toast.error("Não foi possível copiar o código. Tente de novo.");
    }
  }

  return (
    <div className={`${flowCardClassName} space-y-2`}>
      <p className={flowCardTitleClassName}>Pixel criado na conta do cliente</p>
      <p className={flowMonoCaptionClassName}>ID {pixelId}</p>
      <p className={flowWarningClassName}>
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        A campanha só mede vendas depois que este código estiver em todas as páginas do site do
        cliente.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void copyCode()}>
        <Copy className="size-4" aria-hidden />
        Copiar código do pixel
      </Button>
    </div>
  );
}
