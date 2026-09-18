"use client";

import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_AUTOMATIZE_BUSINESS_ID } from "@/lib/meta-business/partner-access-status";

const HOWTO_GIF = "/meta/add-automatize-partner.gif?v=20260918";
const PARTNERS_FALLBACK = "https://business.facebook.com/latest/settings/partners";

export function PartnerAccessHowtoDialog({
  open,
  onOpenChange,
  businessId,
  partnersUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: string | null;
  partnersUrl?: string | null;
}) {
  const id = businessId?.trim() || DEFAULT_AUTOMATIZE_BUSINESS_ID;

  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success("ID copiado. Cole no Facebook.");
    } catch {
      toast.error("Não foi possível copiar o ID");
    }
    window.open(partnersUrl || PARTNERS_FALLBACK, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Como adicionar a Automatize</DialogTitle>
          <DialogDescription>
            Três passos no Gerenciador de Negócios. O ID já vai copiado.
          </DialogDescription>
        </DialogHeader>
        <img
          alt="Como adicionar a Automatize como parceira no Gerenciador de Negócios"
          className="w-full rounded-md border border-border bg-muted/30 object-contain"
          src={HOWTO_GIF}
        />
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Abra Parceiros — o ID já vai copiado.</li>
          <li>Cole o ID e conceda Página, Instagram e conta.</li>
          <li>Volte e toque em Verificar.</li>
        </ol>
        <p className="truncate font-mono text-xs text-muted-foreground">
          ID: {id}
        </p>
        <DialogFooter>
          <Button onClick={() => void copyAndOpen()} type="button">
            <ExternalLink className="size-4" />
            Abrir Parceiros
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
