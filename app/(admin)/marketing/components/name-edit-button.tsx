"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_NAME_LENGTH = 100;

type NameEditEntity = "campaign" | "adset" | "ad";

const ENTITY_LABEL: Record<NameEditEntity, string> = {
  campaign: "campanha",
  adset: "conjunto de anúncios",
  ad: "anúncio",
};

const ENTITY_API_PATH: Record<NameEditEntity, string> = {
  campaign: "campaigns",
  adset: "adsets",
  ad: "ads",
};

type NameEditButtonProps = {
  entityType: NameEditEntity;
  entityId: string;
  currentName?: string;
  accountId: string;
  userId: string;
  onRenamed: (newName: string) => void;
};

export function NameEditButton({
  entityType,
  entityId,
  currentName,
  accountId,
  userId,
  onRenamed,
}: NameEditButtonProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = ENTITY_LABEL[entityType];
  const trimmed = value.trim();

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(currentName ?? "");
    setError(null);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (trimmed.length === 0) {
      setError("O nome não pode ficar vazio.");
      return;
    }

    if (trimmed === (currentName ?? "")) {
      setOpen(false);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/${ENTITY_API_PATH[entityType]}/${entityId}/rename?userId=${userId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? `Falha ao renomear ${label}`);
      }

      setOpen(false);
      onRenamed(data.name ?? trimmed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Erro ao renomear ${label}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={`Editar nome do(a) ${label}`}
        title={`Editar nome do(a) ${label}`}
        onClick={openDialog}
      >
        <Pencil className="size-3.5" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (isSubmitting) return;
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent
          className="sm:max-w-[480px]"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Editar nome do(a) {label}</DialogTitle>
            <DialogDescription>
              O nome deve ter no máximo {MAX_NAME_LENGTH} caracteres.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="space-y-2"
          >
            <Label htmlFor="entity-name">Nome</Label>
            <Input
              id="entity-name"
              value={value}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              disabled={isSubmitting}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {value.length}/{MAX_NAME_LENGTH}
            </p>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || trimmed.length === 0}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
