"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import type { PlanType } from "@/lib/db/schema";

export function VindiPaidOutOfBandCard({
  userId,
  planType,
  newExpiration,
}: {
  userId: string;
  planType: PlanType;
  newExpiration: Date;
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
        body: JSON.stringify({ action: "mark_vindi_paid_out_of_band" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error("Não foi possível registrar o pagamento por fora.", {
          description: data.message ?? data.error ?? "Tente novamente.",
        });
        return;
      }

      toast.success("Pagamento por fora registrado", {
        description:
          "A fatura Vindi aberta foi cancelada e o acesso foi estendido.",
      });
      setConfirmOpen(false);
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
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Pago por fora (Vindi)
          </CardTitle>
          <CardDescription>
            Use quando o cliente já pagou fora da Vindi. A fatura aberta é
            cancelada, o acesso é estendido pelo plano{" "}
            <span className="font-medium text-foreground">
              {PLAN_DEFINITIONS[planType].name}
            </span>{" "}
            e a ação entra no log de auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Nova expiração prevista:{" "}
            <span className="font-medium text-foreground">
              {formatDateTimeInSaoPaulo(newExpiration)}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={isBusy}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Banknote className="mr-2 h-4 w-4" />
            )}
            Registrar pago por fora
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" />
              Registrar pagamento por fora?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A Vindi não tem equivalente a paid_out_of_band. Vamos cancelar a
              fatura aberta, estender o acesso e gravar uma linha de auditoria
              própria. Não use se o Pix ainda puder ser pago.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar pagamento externo
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
