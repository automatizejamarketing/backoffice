"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampaignObjective } from "@/lib/meta-business/types";
import { useMarketingInvalidate } from "../hooks/marketing-queries";

type DuplicateEntity = "campaign" | "adset" | "ad";

function isSalesObjective(objective?: CampaignObjective): boolean {
  return (
    objective === CampaignObjective.OUTCOME_SALES ||
    objective === CampaignObjective.CONVERSIONS
  );
}

const ENTITY_LABEL: Record<DuplicateEntity, string> = {
  campaign: "campanha",
  adset: "conjunto de anúncios",
  ad: "anúncio",
};

const ENTITY_API_PATH: Record<DuplicateEntity, string> = {
  campaign: "campaigns",
  adset: "adsets",
  ad: "ads",
};

const ENTITY_DETAIL: Record<DuplicateEntity, string> = {
  campaign:
    "Será criada uma cópia da campanha com todos os conjuntos e anúncios, mantendo a mesma configuração.",
  adset:
    "Será criada uma cópia do conjunto (com os anúncios) na mesma campanha, mantendo a mesma configuração.",
  ad: "Será criada uma cópia do anúncio no mesmo conjunto, mantendo a mesma configuração.",
};

type DuplicateErrorPayload = {
  message?: string;
  solution?: string;
  orphanIds?: string[];
};

function formatDuplicateError(
  data: DuplicateErrorPayload,
  fallback: string,
): string {
  let message = data.message ?? fallback;
  if (data.solution) message = `${message} ${data.solution}`;
  if (data.orphanIds?.length) {
    message = `${message} Objetos órfãos: ${data.orphanIds.join(", ")}.`;
  }
  return message;
}

type DuplicateButtonProps = {
  entityType: DuplicateEntity;
  entityId: string;
  entityName?: string;
  accountId: string;
  userId: string;
  /**
   * Campaign objective. For sales objectives the dialog offers a website-URL
   * field, used by the server to repair ad copies whose creative lacks the
   * link Meta now requires (subcode 2446383).
   */
  objective?: CampaignObjective;
  onDuplicated?: () => void;
  /** `icon` for table rows, `labeled` for detail headers. */
  variant?: "icon" | "labeled";
};

export function DuplicateButton({
  entityType,
  entityId,
  entityName,
  accountId,
  userId,
  objective,
  onDuplicated,
  variant = "icon",
}: DuplicateButtonProps) {
  const invalidateMarketing = useMarketingInvalidate(accountId, userId);
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promotionUrl, setPromotionUrl] = useState("");
  const [promotionUrlError, setPromotionUrlError] = useState<string | null>(
    null,
  );

  const label = ENTITY_LABEL[entityType];
  const showPromotionUrlField = isSalesObjective(objective);

  const resetState = () => {
    setError(null);
    setPromotionUrl("");
    setPromotionUrlError(null);
  };

  const handleConfirm = async () => {
    const trimmedUrl = promotionUrl.trim();
    if (trimmedUrl && !/^https?:\/\/\S+\.\S+/.test(trimmedUrl)) {
      setPromotionUrlError(
        "Informe uma URL válida começando com https://",
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setPromotionUrlError(null);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/${ENTITY_API_PATH[entityType]}/${entityId}/duplicate?userId=${userId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            trimmedUrl ? { promotionUrl: trimmedUrl } : {},
          ),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          formatDuplicateError(data, `Falha ao duplicar ${label}`),
        );
      }

      void invalidateMarketing();
      onDuplicated?.();
      toast.success(
        `"${data.name ?? entityName ?? ""}" duplicado com sucesso`,
      );
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Erro ao duplicar ${label}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    resetState();
  };

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetState();
    setOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={`Duplicar ${label}`}
          title={`Duplicar ${label}`}
          onClick={openDialog}
        >
          <Copy className="size-3.5" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-8 text-xs"
          onClick={openDialog}
        >
          <Copy className="size-3.5 mr-1.5" />
          Duplicar
        </Button>
      )}

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (isSubmitting) return;
          setOpen(next);
          if (!next) resetState();
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Duplicar ${label}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`${entityName ? `"${entityName}" — ` : ""}${ENTITY_DETAIL[entityType]} A cópia herda o status do original e o nome recebe o sufixo " - Cópia".`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {showPromotionUrlField && (
            <div className="space-y-1.5">
              <Label htmlFor="duplicate-promotion-url" className="text-sm">
                URL do site (opcional)
              </Label>
              <Input
                id="duplicate-promotion-url"
                type="url"
                inputMode="url"
                placeholder="https://seusite.com.br/oferta"
                value={promotionUrl}
                disabled={isSubmitting}
                onChange={(e) => {
                  setPromotionUrl(e.target.value);
                  setPromotionUrlError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                A Meta exige uma URL de site em anúncios de vendas. Se os
                anúncios da cópia falharem por falta de link, informe a URL
                aqui para tentar reparar automaticamente.
              </p>
              {promotionUrlError && (
                <p className="text-xs text-destructive">{promotionUrlError}</p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              Cancelar
            </Button>
            <Button disabled={isSubmitting} onClick={handleConfirm}>
              {isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Duplicar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
