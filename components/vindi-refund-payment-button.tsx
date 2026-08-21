"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function VindiRefundPaymentButton({
  userId,
  paymentId,
  amountLabel,
  description,
}: {
  userId: string;
  paymentId: string;
  amountLabel: string;
  description: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isBusy = submitting || isPending;

  async function submit() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refund_vindi_charge", paymentId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error("Não foi possível estornar o pagamento.", {
          description: data.message ?? data.error ?? "Tente novamente.",
        });
        return;
      }

      toast.success("Estorno solicitado na Vindi", {
        description:
          "O valor volta ao cliente pelo mesmo método do pagamento. Acesso e créditos não mudam automaticamente.",
      });
      setOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error("Erro inesperado", {
        description:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir a operação.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Undo2 className="h-3.5 w-3.5" />
        Estornar
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!isBusy) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar pagamento na Vindi</AlertDialogTitle>
            <AlertDialogDescription>
              {description ? `${description} · ` : ""}
              {amountLabel}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              O estorno é total e feito pela API da Vindi: o valor volta ao
              cliente pelo mesmo método do pagamento.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>O pagamento fica marcado como Reembolsado.</li>
              <li>
                O acesso (data de expiração) e os créditos do usuário NÃO mudam
                — ajuste manualmente se necessário.
              </li>
              <li>
                Requer saldo disponível na conta Vindi; sem saldo, a Vindi
                recusa o pedido.
              </li>
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy}
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {isBusy ? "Estornando…" : "Estornar pagamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
