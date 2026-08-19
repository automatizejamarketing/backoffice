"use client";

import { Copy } from "lucide-react";
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
import { formatBrazilianPhone } from "@/lib/phone";

async function copyValue(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto manualmente.");
  }
}

export function UserContactDialog({
  open,
  onOpenChange,
  userName,
  userEmail,
  userPhone,
  contacted,
  onToggleContacted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string | null;
  userEmail: string;
  userPhone: string | null | undefined;
  contacted: boolean;
  onToggleContacted: (contacted: boolean) => void;
}) {
  const displayName = userName?.trim() || userEmail;
  const phoneFormatted = formatBrazilianPhone(userPhone);
  const phoneValue = phoneFormatted ?? userPhone?.trim() ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dados do contato</DialogTitle>
          <DialogDescription>
            Copie os dados do cliente e marque quando a conversa já tiver
            acontecido. Esse registro fica só neste navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Nome</p>
              <p className="truncate text-sm font-medium">{displayName}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void copyValue(displayName, "Nome copiado")}
            >
              <Copy />
              Copiar
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Celular</p>
              <p className="truncate text-sm font-medium">
                {phoneValue || "Sem telefone"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={!phoneValue}
              aria-label="Copiar celular"
              onClick={() =>
                phoneValue
                  ? void copyValue(phoneValue, "Celular copiado")
                  : undefined
              }
            >
              <Copy />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant={contacted ? "outline" : "default"}
            onClick={() => {
              onToggleContacted(!contacted);
              onOpenChange(false);
            }}
          >
            {contacted ? "Não entrei em contato" : "Marcar que entrei em contato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
