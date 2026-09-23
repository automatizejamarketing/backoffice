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
import {
  AUTOMATIZE_PEOPLE_EMAIL,
  META_BUSINESS_PEOPLE_URL,
} from "@/lib/meta-business/partner-access-status";

const HOWTO_GIF = "/meta/add-automatize-partner.gif?v=20260923";

export function PartnerAccessHowtoDialog({
  open,
  onOpenChange,
  settingsUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settingsUrl?: string | null;
}) {
  const href = settingsUrl?.trim() || META_BUSINESS_PEOPLE_URL;

  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(AUTOMATIZE_PEOPLE_EMAIL);
      toast.success("E-mail copiado. Cole no Facebook.");
    } catch {
      toast.error("Não foi possível copiar o e-mail");
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Como adicionar a Automatize</DialogTitle>
          <DialogDescription>
            Três passos no Gerenciador de Negócios. O e-mail já vai copiado.
          </DialogDescription>
        </DialogHeader>
        <img
          alt="Como convidar a Automatize em Pessoas no Gerenciador de Negócios"
          className="w-full rounded-md border border-border bg-muted/30 object-contain"
          src={HOWTO_GIF}
        />
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Abra Pessoas — o e-mail já vai copiado.</li>
          <li>Cole o e-mail, conceda acesso total e avance até enviar o convite</li>
          <li>Volte e toque em Já compartilhei.</li>
        </ol>
        <p className="truncate font-mono text-xs text-muted-foreground">
          E-mail: {AUTOMATIZE_PEOPLE_EMAIL}
        </p>
        <DialogFooter>
          <Button onClick={() => void copyAndOpen()} type="button">
            <ExternalLink className="size-4" />
            Abrir Pessoas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
