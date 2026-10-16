"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { HeldProductPaymentView } from "@/app/api/products/admin/held-payments/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

const STATUS_LABEL: Record<string, string> = {
  split_divergence: "Divisão não conferiu",
  account_divergence: "Conta recebedora divergente",
  settlement_mismatch: "Valor ou origem não conferiu",
  approved_waiting_settlement: "Aguardando líquido do MP",
};

function money(amountCentavos: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCentavos / 100);
}

function paymentLabel(payment: HeldProductPaymentView): string {
  const method = payment.paymentMethodId ?? "—";
  return payment.installments && payment.installments > 1
    ? `${method} ${payment.installments}x`
    : method;
}

/**
 * Pagamentos que o Mercado Pago aprovou e a conciliação segurou: o comprador
 * pagou e está sem Acesso. Cada um também foi avisado no Slack. Depois de
 * corrigida a causa, Reprocessar relê o pagamento no provedor e reaplica a
 * regra — o mesmo caminho do webhook. Some da tela quando não há nenhum.
 */
export function HeldPaymentsPanel() {
  const [payments, setPayments] = useState<HeldProductPaymentView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/products/admin/held-payments", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Falha ao carregar pagamentos retidos");
      setPayments((await response.json()) as HeldProductPaymentView[]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Falha ao carregar pagamentos retidos",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reprocess(providerPaymentId: string) {
    setReprocessingId(providerPaymentId);
    try {
      const response = await fetch(
        `/api/products/admin/held-payments/${providerPaymentId}/reprocess`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível reprocessar.");
      }
      if (payload.status === "processed" || payload.status === "already_processed") {
        toast.success("Pagamento liberado. O comprador recebe o acesso por e-mail.");
      } else {
        toast.warning(`Continua retido (${payload.status ?? "sem status"}).`);
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível reprocessar.",
      );
    } finally {
      setReprocessingId(null);
    }
  }

  if (!isLoading && payments.length === 0) return null;

  return (
    <Card className="mb-6 border-destructive/40">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Pagamentos retidos</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "Carregando…"
              : `${payments.length} aprovado${payments.length > 1 ? "s" : ""} no Mercado Pago sem Acesso liberado. Corrija a causa e reprocesse.`}
          </p>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCw className="size-4" />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Produto</TableHead>
              <TableHead>Comprador</TableHead>
              <TableHead>Pagamento MP</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Retido desde</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell className="h-28 text-center" colSpan={7}>
                  <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment.providerPaymentId}>
                  <TableCell>
                    <p className="font-medium">{payment.productTitle}</p>
                    {payment.expertName ? (
                      <p className="text-xs text-muted-foreground">
                        {payment.expertName}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{payment.buyerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {payment.buyerEmail}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <p className="font-mono text-xs">{payment.providerPaymentId}</p>
                    <p className="text-xs text-muted-foreground">
                      {paymentLabel(payment)}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                    {money(payment.amountCentavos)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive">
                      {STATUS_LABEL[payment.rawStatus] ?? payment.rawStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatShortDateTimeInSaoPaulo(payment.heldSince)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      disabled={reprocessingId !== null}
                      onClick={() => void reprocess(payment.providerPaymentId)}
                      size="sm"
                      type="button"
                    >
                      {reprocessingId === payment.providerPaymentId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Reprocessar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
