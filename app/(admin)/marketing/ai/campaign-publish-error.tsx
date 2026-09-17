"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_AUTOMATIZE_BUSINESS_ID,
  looksLikeCertificationRequired,
} from "@/lib/meta-business/partner-access-status";

const PARTNERS_URL = "https://business.facebook.com/latest/settings/partners";

export function CampaignPublishError({ error }: { error: string }) {
  const [showMeta, setShowMeta] = useState(false);
  const certification = looksLikeCertificationRequired(error);

  if (!certification) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  const copyId = async (announce: boolean) => {
    try {
      await navigator.clipboard.writeText(DEFAULT_AUTOMATIZE_BUSINESS_ID);
      if (announce) toast.success("ID copiado");
      return true;
    } catch {
      if (announce) toast.error("Não foi possível copiar o ID");
      return false;
    }
  };

  const openPartners = async () => {
    const copied = await copyId(false);
    if (copied) toast.success("ID copiado. Cole no Facebook.");
    window.open(PARTNERS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-destructive">
          A Meta exige a certificação da empresa
        </p>
        <p className="text-sm text-destructive/90">
          Um admin do Gerenciador de Negócios precisa aceitar a política. Peça ao
          cliente para compartilhar Página, Instagram e conta com a Automatize —
          publicar de novo agora devolve o mesmo erro.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void openPartners()} size="sm" type="button">
          <ExternalLink className="size-4" />
          Abrir Parceiros
        </Button>
        <Button
          onClick={() => void copyId(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy className="size-4" />
          Copiar ID
        </Button>
      </div>
      <button
        className="text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setShowMeta((open) => !open)}
        type="button"
      >
        {showMeta ? "Ocultar texto da Meta" : "Ver texto da Meta"}
      </button>
      {showMeta ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
      ) : null}
    </div>
  );
}
