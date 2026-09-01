"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, QrCode, RotateCw } from "lucide-react";
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
import type { BackofficeVindiRecoveryView } from "@/lib/vindi/subscription-panel";

type RecoveryMode = "retry" | "reissue";

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function VindiPaymentRecoveryCard({
  userId,
  recovery,
}: {
  userId: string;
  recovery: BackofficeVindiRecoveryView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<RecoveryMode | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<RecoveryMode | null>(null);
  const isBusy = submitting !== null || isPending;

  async function submit(mode: RecoveryMode) {
    setSubmitting(mode);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover_vindi_payment", mode }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        emvPayload?: string;
        reused?: boolean;
      };

      if (!response.ok) {
        toast.error(
          mode === "reissue"
            ? "Não foi possível gerar o Pix desta fatura."
            : "Não foi possível retentar a cobrança.",
          {
            description: data.message ?? data.error ?? "Tente novamente.",
          },
        );
        return;
      }

      toast.success(
        mode === "reissue"
          ? data.reused
            ? "Pix de recuperação reutilizado"
            : "Pix da fatura gerado"
          : "Cobrança reenviada à Vindi",
        {
          description:
            mode === "reissue"
              ? "O copia-e-cola aparece no card de Pix de renovação."
              : "Se a cobrança confirmar, o webhook reativa a assinatura.",
        },
      );
      setConfirmOpen(null);
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
      setSubmitting(null);
    }
  }

  return (
    <>
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Recuperar pagamento Vindi
          </CardTitle>
          <CardDescription>
            A última cobrança falhou. Retente no cartão ou gere um Pix desta
            fatura — o método da assinatura não muda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Valor</dt>
              <dd className="text-base font-semibold text-foreground">
                {formatMoney(recovery.amountCents, recovery.currency)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Última falha</dt>
              <dd className="text-sm font-medium text-foreground">
                {formatDateTimeInSaoPaulo(recovery.failedAt)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                Motivo retornado pela Vindi
              </dt>
              <dd className="break-words text-sm font-medium text-foreground">
                {recovery.failureReason?.trim() || "—"}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Vindi Charge ID</dt>
              <dd className="break-all font-mono text-[12px] text-foreground/90">
                {recovery.chargeId}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {recovery.retryAllowed ? (
              <Button
                type="button"
                onClick={() => setConfirmOpen("retry")}
                disabled={isBusy}
              >
                {submitting === "retry" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="mr-2 h-4 w-4" />
                )}
                Tentar cobrar novamente
              </Button>
            ) : null}
            {recovery.reissueAllowed ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen("reissue")}
                disabled={isBusy}
              >
                {submitting === "reissue" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="mr-2 h-4 w-4" />
                )}
                Gerar Pix desta fatura
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen === "retry"}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tentar cobrar novamente?</AlertDialogTitle>
            <AlertDialogDescription>
              A Vindi vai retentar a cobrança no cartão já cadastrado. O método
              da assinatura não muda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting !== null}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void submit("retry")}
              disabled={submitting !== null}
            >
              {submitting === "retry" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar cobrança
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmOpen === "reissue"}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar Pix desta fatura?</AlertDialogTitle>
            <AlertDialogDescription>
              A fatura em atraso será reemitida como Pix QR. A assinatura
              continua no método original.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting !== null}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void submit("reissue")}
              disabled={submitting !== null}
            >
              {submitting === "reissue" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Gerar Pix
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
