"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BackofficeVindiCancelView } from "@/lib/vindi/subscription-panel";

export function VindiSubscriptionCancelButton({
  userId,
  cancel,
}: {
  userId: string;
  cancel: BackofficeVindiCancelView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isBusy = submitting || isPending;

  async function submit() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_vindi_subscription" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        mode?: string;
      };

      if (!response.ok) {
        toast.error("Não foi possível cancelar a assinatura Vindi.", {
          description: data.message ?? data.error ?? "Tente novamente.",
        });
        return;
      }

      toast.success(
        data.mode === "cancel_requested"
          ? "Intenção de cancelamento registrada"
          : "Assinatura Vindi cancelada",
        {
          description:
            data.mode === "cancel_requested"
              ? "A cobrança agendada vale. O cancelamento efetiva após o vencimento."
              : "O acesso segue até o fim do período já pago.",
        },
      );
      setConfirmOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error("Erro inesperado", {
        description:
          error instanceof Error
            ? error.message
            : "Não foi possível cancelar a assinatura.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setConfirmOpen(true)}
        disabled={isBusy}
      >
        {submitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <XCircle className="mr-2 h-4 w-4" />
        )}
        Cancelar assinatura Vindi
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {cancel.inSchedulingWindow ? (
                <AlertTriangle className="size-5 text-amber-600" />
              ) : null}
              Cancelar assinatura Vindi?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {cancel.inSchedulingWindow ? (
                <span className="block">{cancel.copy.inWindow}</span>
              ) : (
                <span className="block">
                  A assinatura será encerrada agora na Vindi. O acesso segue até
                  o fim do período já pago, sem reembolso proporcional.
                </span>
              )}
              {cancel.copy.cancelUntil ? (
                <span className="block">{cancel.copy.cancelUntil}</span>
              ) : null}
              {cancel.copy.reopensOn ? (
                <span className="block">{cancel.copy.reopensOn}</span>
              ) : null}
              {cancel.copy.consentRemains ? (
                <span className="block">{cancel.copy.consentRemains}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Voltar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar cancelamento
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
