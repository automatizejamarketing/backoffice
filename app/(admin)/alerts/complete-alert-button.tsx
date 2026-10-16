"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { PLAYBOOK_DASHBOARD_COMPLETION_NOTE } from "@/lib/backoffice/playbook-alert-dashboard";

export function CompleteAlertButton({
  userId,
  insightId,
  title,
  insightIds,
}: {
  userId: string;
  insightId?: string;
  insightIds?: string[];
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const grouped = insightIds !== undefined;

  async function complete() {
    setPending(true);
    try {
      const response = await fetch(`/api/users/${userId}/playbook-insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(grouped ? { insightIds } : { insightId }),
          status: "done",
          reviewNote: PLAYBOOK_DASHBOARD_COMPLETION_NOTE,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        completed?: number;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Falha ao concluir o alerta");
      }
      toast.success(
        grouped
          ? `${body?.completed ?? 0} alerta(s) concluído(s)`
          : "Alerta marcado como concluído",
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao concluir o alerta",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || (grouped && insightIds.length === 0)}
        onClick={() => setOpen(true)}
      >
        {grouped ? "Concluir todos" : "Concluir"}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {grouped
                ? "Concluir todos os alertas deste grupo?"
                : "Marcar como concluído?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {grouped
                ? `Os ${insightIds.length} alertas pendentes de “${title}” neste grupo saem da fila e passam para Finalizados.`
                : `“${title}” sai da fila de pendentes e passa para Finalizados.`}{" "}
              Isso não aplica alteração automática na Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void complete()}
            >
              {pending
                ? "Concluindo..."
                : grouped
                  ? "Concluir todos"
                  : "Concluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
