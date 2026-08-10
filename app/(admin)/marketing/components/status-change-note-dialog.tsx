"use client";

/**
 * O motivo de pausar ou retomar, pedido antes de a alteração sair daqui.
 *
 * Até este ticket, mudar o status era a única mutação do backoffice que não
 * registrava nada — nem log de auditoria, nem motivo (§7 do plano
 * `docs/plans/campaign-tracking-foundation.md`). A rota agora recusa a
 * alteração sem motivo; este diálogo é o lado do gestor dessa regra, e é o
 * mesmo nos três níveis para que o ponto cego não volte por um deles.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

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

export type StatusChangeRequest = {
  entityId: string;
  entityName?: string | null;
  /** `true` quando a ação vai ATIVAR a entidade. */
  activating: boolean;
};

type StatusChangeNoteDialogProps = {
  /** Aberto quando há uma mudança pendente de motivo. */
  request: StatusChangeRequest | null;
  entityLabel: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
};

export function StatusChangeNoteDialog({
  request,
  entityLabel,
  isSubmitting = false,
  onCancel,
  onConfirm,
}: StatusChangeNoteDialogProps) {
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  const action = request?.activating ? "Ativar" : "Pausar";

  const close = () => {
    setNote("");
    onCancel();
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (isSubmitting || next) return;
        close();
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>
            {action} {entityLabel}
          </DialogTitle>
          <DialogDescription>
            {request?.entityName
              ? `"${request.entityName}" — o motivo fica registrado no histórico de ações.`
              : "O motivo fica registrado no histórico de ações."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length === 0) return;
            onConfirm(trimmed);
            setNote("");
          }}
          className="space-y-2"
        >
          <Label htmlFor="status-change-note">
            Nota Explicativa <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="status-change-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explique o motivo desta alteração..."
            className="min-h-[80px]"
            autoFocus
            disabled={isSubmitting}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={close}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || trimmed.length === 0}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
