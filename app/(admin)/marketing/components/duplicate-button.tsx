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

function isValidPromotionUrl(value: string): boolean {
  return /^https:\/\/.+/i.test(value.trim());
}

type DuplicateErrorPayload = {
  message?: string;
  solution?: string;
  orphanIds?: string[];
  needsPromotionUrl?: boolean;
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
   * Campaign objective. Kept for call-site compatibility; the promotion-URL
   * field is now shown reactively (only after Meta rejects a copy with subcode
   * 2446383), so this is no longer used to gate the field.
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
  onDuplicated,
  variant = "icon",
}: DuplicateButtonProps) {
  const invalidateMarketing = useMarketingInvalidate(accountId, userId);
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPromotionUrl, setNeedsPromotionUrl] = useState(false);
  const [promotionUrl, setPromotionUrl] = useState("");
  const [promotionUrlError, setPromotionUrlError] = useState<string | null>(
    null,
  );

  const label = ENTITY_LABEL[entityType];

  const resetState = () => {
    setError(null);
    setNeedsPromotionUrl(false);
    setPromotionUrl("");
    setPromotionUrlError(null);
  };

  const runDuplication = async () => {
    setIsSubmitting(true);
    setError(null);
    setPromotionUrlError(null);

    const trimmedUrl = promotionUrl.trim();

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/${ENTITY_API_PATH[entityType]}/${entityId}/duplicate?userId=${userId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            needsPromotionUrl && trimmedUrl ? { promotionUrl: trimmedUrl } : {},
          ),
        },
      );

      const data: DuplicateErrorPayload & { name?: string } =
        await response.json();

      if (!response.ok) {
        // Meta refused a copy because the creative is missing the website URL
        // sales objectives require. Switch the dialog into the reactive
        // "ask for URL" mode instead of showing a raw error.
        if (data?.needsPromotionUrl) {
          const wasAlreadyAsking = needsPromotionUrl;
          setNeedsPromotionUrl(true);
          if (wasAlreadyAsking) {
            setPromotionUrlError(
              "Não foi possível concluir com esse link. Verifique o endereço e tente novamente.",
            );
          }
          return;
        }
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
      resetState();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Erro ao duplicar ${label}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (needsPromotionUrl) {
      const trimmedUrl = promotionUrl.trim();
      if (!trimmedUrl) {
        setPromotionUrlError("Informe o link do seu site para continuar.");
        return;
      }
      if (!isValidPromotionUrl(trimmedUrl)) {
        setPromotionUrlError(
          "Informe uma URL válida começando com https://",
        );
        return;
      }
    }
    await runDuplication();
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
            <AlertDialogTitle>
              {needsPromotionUrl
                ? "Falta o link do seu site"
                : `Duplicar ${label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {needsPromotionUrl
                ? "A Meta exige um link de destino para concluir a cópia deste anúncio de vendas. Informe o link do seu site (ou da oferta) para continuarmos a duplicação."
                : `${entityName ? `"${entityName}" — ` : ""}${ENTITY_DETAIL[entityType]} A cópia herda o status do original e o nome recebe o sufixo " - Cópia".`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {needsPromotionUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="duplicate-promotion-url" className="text-sm">
                Link do site
              </Label>
              <Input
                id="duplicate-promotion-url"
                type="url"
                inputMode="url"
                autoFocus
                placeholder="https://seusite.com.br/oferta"
                value={promotionUrl}
                disabled={isSubmitting}
                onChange={(e) => {
                  setPromotionUrl(e.target.value);
                  setPromotionUrlError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Use um endereço começando com https://. Aplicaremos esse link na
                cópia e concluiremos a duplicação automaticamente.
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
              {needsPromotionUrl ? "Continuar duplicação" : "Duplicar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
