"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type DuplicateButtonProps = {
  entityType: DuplicateEntity;
  entityId: string;
  entityName?: string;
  accountId: string;
  userId: string;
  onDuplicated: () => void;
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
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = ENTITY_LABEL[entityType];

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/${ENTITY_API_PATH[entityType]}/${entityId}/duplicate?userId=${userId}`,
        { method: "POST" },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? `Falha ao duplicar ${label}`);
      }

      setOpen(false);
      onDuplicated();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Erro ao duplicar ${label}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
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
          if (!next) setError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicar {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {entityName ? `"${entityName}" — ` : ""}
              {ENTITY_DETAIL[entityType]} A cópia herda o status do original e o
              nome recebe o sufixo &quot; - Cópia&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button disabled={isSubmitting} onClick={handleConfirm}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Duplicar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
