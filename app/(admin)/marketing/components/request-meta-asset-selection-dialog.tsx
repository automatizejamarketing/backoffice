"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRequestMetaAssetSelection } from "../hooks/use-meta-assets";

type RequestMetaAssetSelectionDialogProps = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RequestMetaAssetSelectionDialog({
  userId,
  open,
  onOpenChange,
}: RequestMetaAssetSelectionDialogProps) {
  const [note, setNote] = useState("");
  const requestSelection = useRequestMetaAssetSelection(userId);

  const handleSubmit = async () => {
    try {
      await requestSelection.mutateAsync(note);
      toast.success("Nova seleção pedida");
      setNote("");
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível pedir a nova seleção");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!requestSelection.isPending) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pedir nova seleção</DialogTitle>
          <DialogDescription>
            O usuário volta à Seleção pendente e precisa escolher de novo os
            Ativos habilitados. A observação aparece no modal dele.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="meta-asset-request-note">Observação (opcional)</Label>
          <Textarea
            id="meta-asset-request-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Por que a seleção precisa ser refeita"
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={requestSelection.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={requestSelection.isPending}
          >
            {requestSelection.isPending ? "Pedindo..." : "Pedir nova seleção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
