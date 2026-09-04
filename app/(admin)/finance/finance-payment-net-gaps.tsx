"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FinancePaymentNetGap } from "@/lib/backoffice/finance-payments";
import { financeProviderLabel } from "@/lib/backoffice/finance-provider";
import {
  formatBRLFromCentavos,
  formatFinanceDateTime,
} from "@/lib/backoffice/finance-format";

const REASON_LABELS: Record<FinancePaymentNetGap["reason"], string> = {
  stripe_settlement_unavailable:
    "Stripe ainda não retornou liquidação para esta fatura",
  mercadopago_fees_pending:
    "Mercado Pago ainda não informou taxas para este PIX",
  mercadopago_payment_not_found:
    "Pagamento PIX não encontrado na conta Mercado Pago configurada",
};

type FinancePaymentNetGapsProps = {
  gaps: FinancePaymentNetGap[];
  backfillQuery: string;
};

export function FinancePaymentNetGaps({
  gaps,
  backfillQuery,
}: FinancePaymentNetGapsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (gaps.length === 0) {
    return null;
  }

  const stripeCount = gaps.filter((gap) => gap.provider === "stripe").length;
  const mercadopagoCount = gaps.filter(
    (gap) => gap.provider === "mercadopago",
  ).length;

  const handleBackfill = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/finance/payments/backfill-settlements?${backfillQuery}`,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        updated?: number;
        stillPending?: number;
        failed?: number;
        errors?: string[];
        error?: string;
      };

      if (!response.ok) {
        toast.error("Não foi possível buscar taxas no gateway.", {
          description: data.error ?? "Tente novamente em instantes.",
        });
        return;
      }

      toast.success("Atualização concluída.", {
        description: `${data.updated ?? 0} pagamento(s) atualizado(s)${
          data.stillPending ? `, ${data.stillPending} ainda pendente(s)` : ""
        }.`,
      });

      if (data.errors?.length) {
        toast.warning("Alguns pagamentos não puderam ser atualizados.", {
          description: data.errors.slice(0, 2).join(" · "),
        });
      }

      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSubmitting || isPending;

  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/30 bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b border-amber-500/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Pendências de liquidação ({gaps.length})
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {stripeCount > 0
              ? `${stripeCount} cartão (Stripe)`
              : null}
            {stripeCount > 0 && mercadopagoCount > 0 ? " · " : null}
            {mercadopagoCount > 0
              ? `${mercadopagoCount} PIX (Mercado Pago)`
              : null}
            {" — "}
            estes pagamentos entram no bruto, mas ainda não têm líquido
            confirmado pelo gateway.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={handleBackfill}
        >
          {isBusy ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Buscar taxas no gateway
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Data</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Meio</TableHead>
            <TableHead>Referência</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {gaps.map((gap) => (
            <TableRow key={gap.paymentId}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatFinanceDateTime(gap.paidAt)}
              </TableCell>
              <TableCell className="font-medium">{gap.userEmail}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {financeProviderLabel(gap)}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                {gap.reference ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                {formatBRLFromCentavos(gap.grossCentavos)}
              </TableCell>
              <TableCell className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                {REASON_LABELS[gap.reason]}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
