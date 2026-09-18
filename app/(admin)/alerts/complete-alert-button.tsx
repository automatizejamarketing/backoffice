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
}: {
  userId: string;
  insightId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function complete() {
    setPending(true);
    try {
      const response = await fetch(`/api/users/${userId}/playbook-insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insightId,
          status: "done",
          reviewNote: PLAYBOOK_DASHBOARD_COMPLETION_NOTE,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Falha ao concluir o alerta");
      }
      toast.success("Alerta marcado como concluído");
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
        onClick={() => setOpen(true)}
      >
        Concluir
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
            <AlertDialogTitle>Marcar como concluído?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” sai da fila de pendentes e passa para Finalizados. Isso
              não aplica alteração automática na Meta.
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
            <Button type="button" disabled={pending} onClick={() => void complete()}>
              {pending ? "Concluindo..." : "Concluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
