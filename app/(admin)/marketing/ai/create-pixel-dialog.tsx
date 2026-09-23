"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { flowErrorClassName } from "./flow-chrome";
import { PIXEL_NAME_MAX_LENGTH } from "./pixel-step";

const CREATE_FAILED = "Não foi possível criar o pixel. Tente de novo.";

type CreatePixelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  userId: string;
  defaultName: string;
  onCreated: (pixel: { id: string; name: string }) => void;
  /** Meta said the account already has a pixel (409): the caller re-reads the list. */
  onAlreadyExists: () => void;
};

export function CreatePixelDialog({
  open,
  onOpenChange,
  accountId,
  userId,
  defaultName,
  onCreated,
  onAlreadyExists,
}: CreatePixelDialogProps) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setError(null);
    setCreating(false);
  }, [open, defaultName]);

  const trimmed = name.trim();

  async function create() {
    if (!trimmed) {
      setError("Dê um nome ao pixel.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/meta-marketing/${accountId}/pixels?userId=${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        message?: string;
      };
      if (res.ok && data.id) {
        onCreated({ id: data.id, name: data.name ?? trimmed });
        onOpenChange(false);
        return;
      }
      if (res.status === 409) {
        onAlreadyExists();
        onOpenChange(false);
        return;
      }
      setError(data.message || CREATE_FAILED);
    } catch {
      setError(CREATE_FAILED);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (creating ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar pixel na conta do cliente</DialogTitle>
          <DialogDescription>
            O pixel fica na conta de anúncios do cliente. A Meta não deixa apagar depois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="ai-pixel-name">Nome do pixel</Label>
          <Input
            id="ai-pixel-name"
            value={name}
            maxLength={PIXEL_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            disabled={creating}
            autoFocus
          />
          {error ? <p className={flowErrorClassName}>{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void create()} disabled={creating || !trimmed}>
            {creating ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Criando…
              </>
            ) : (
              "Criar pixel"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
