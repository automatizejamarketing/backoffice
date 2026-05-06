"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  Loader2,
  RotateCw,
} from "lucide-react";
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

type RecoveryMode = "retry" | "mark_paid_oob";

interface PaymentRecoveryCardProps {
  userId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  failedAt: Date | string;
  subscriptionStatus: "past_due" | "unpaid";
}

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

function formatDateTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

const STATUS_LABELS: Record<"past_due" | "unpaid", string> = {
  past_due: "Pagamento atrasado",
  unpaid: "Não paga",
};

export function PaymentRecoveryCard({
  userId,
  invoiceId,
  amountCents,
  currency,
  failureReason,
  failedAt,
  subscriptionStatus,
}: PaymentRecoveryCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<RecoveryMode | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<RecoveryMode | null>(null);

  const isBusy = submitting !== null || isPending;

  const submitRecovery = async (mode: RecoveryMode) => {
    setSubmitting(mode);
    try {
      const response = await fetch(`/api/subscriptions/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover_payment", mode }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        newStripeStatus?: string | null;
      };

      if (!response.ok) {
        const fallback =
          mode === "mark_paid_oob"
            ? "Não foi possível marcar a fatura como paga."
            : "Não foi possível recobrar o pagamento.";
        toast.error(fallback, {
          description:
            data.message ?? data.error ?? "Tente novamente em instantes.",
        });
        return;
      }

      const successTitle =
        mode === "mark_paid_oob"
          ? "Fatura marcada como paga externamente"
          : "Pagamento recobrado com sucesso";
      toast.success(successTitle, {
        description:
          mode === "mark_paid_oob"
            ? "A fatura foi fechada no Stripe sem cobrança no cartão. A assinatura será reativada em instantes."
            : "O Stripe processou a cobrança. A assinatura será reativada em instantes.",
      });

      setConfirmOpen(null);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      console.error("Error recovering payment:", error);
      toast.error("Erro inesperado", {
        description:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir a operação.",
      });
    } finally {
      setSubmitting(null);
    }
  };

  const closeConfirm = (open: boolean) => {
    if (!open && !submitting) {
      setConfirmOpen(null);
    }
  };

  return (
    <>
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Recuperar pagamento pendente
          </CardTitle>
          <CardDescription>
            A última cobrança falhou e a assinatura está com status{" "}
            <span className="font-medium text-foreground">
              {STATUS_LABELS[subscriptionStatus]}
            </span>
            . Use os botões abaixo após confirmar com o cliente o melhor caminho
            para regularizar o pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
            <div className="flex flex-col gap-0.5 min-w-0">
              <dt className="text-xs text-muted-foreground">Valor</dt>
              <dd className="text-base font-semibold text-foreground">
                {formatMoney(amountCents, currency)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <dt className="text-xs text-muted-foreground">Última falha</dt>
              <dd className="text-sm font-medium text-foreground">
                {formatDateTime(failedAt)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                Motivo retornado pelo Stripe
              </dt>
              <dd className="text-sm font-medium text-foreground break-words">
                {failureReason && failureReason.trim().length > 0
                  ? failureReason
                  : "—"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                Stripe Invoice ID
              </dt>
              <dd className="font-mono text-[12px] text-foreground/90 break-all">
                {invoiceId}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              onClick={() => setConfirmOpen("retry")}
              disabled={isBusy}
              className="sm:w-auto"
            >
              {submitting === "retry" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cobrando...
                </>
              ) : (
                <>
                  <RotateCw className="mr-2 h-4 w-4" />
                  Tentar cobrar novamente
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen("mark_paid_oob")}
              disabled={isBusy}
              className="sm:w-auto"
            >
              {submitting === "mark_paid_oob" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Marcando...
                </>
              ) : (
                <>
                  <Banknote className="mr-2 h-4 w-4" />
                  Marcar como pago externamente
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Após o sucesso de qualquer uma das ações, o Stripe enviará um webhook
            que reativa a assinatura, estende o acesso e deposita os créditos
            mensais automaticamente. A página será atualizada em seguida.
          </p>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen === "retry"}
        onOpenChange={closeConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tentar cobrar novamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Será feita uma nova tentativa de cobrança no método de pagamento
              padrão atualmente cadastrado no Stripe deste cliente. Caso o
              cartão falhe novamente, o motivo retornado pelo Stripe aparecerá
              em uma mensagem de erro nesta tela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Valor a cobrar: </span>
            <span className="font-medium text-foreground">
              {formatMoney(amountCents, currency)}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting !== null}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void submitRecovery("retry")}
              disabled={submitting !== null}
            >
              {submitting === "retry" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cobrando...
                </>
              ) : (
                "Confirmar cobrança"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmOpen === "mark_paid_oob"}
        onOpenChange={closeConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" />
              Marcar fatura como paga externamente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Use esta opção <strong>apenas</strong> se o cliente já pagou por
              outro canal (PIX, transferência, dinheiro). A fatura será fechada
              no Stripe como paga, sem cobrança no cartão, e o acesso do
              cliente será liberado. Esta ação fica registrada no log de
              auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Valor a marcar como pago:{" "}
            </span>
            <span className="font-medium text-foreground">
              {formatMoney(amountCents, currency)}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting !== null}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void submitRecovery("mark_paid_oob")}
              disabled={submitting !== null}
            >
              {submitting === "mark_paid_oob" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Marcando...
                </>
              ) : (
                "Confirmar pagamento externo"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
