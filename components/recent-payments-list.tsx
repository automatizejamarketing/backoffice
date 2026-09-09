import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { Payment } from "@/lib/db/schema";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { billingProviderLabel } from "@/lib/backoffice/subscription-panel-policy";
import { formatPlanLabel, type StatusBadgeProps } from "@/lib/subscriptions/derive";

const PAYMENT_BADGES: Record<Payment["status"], StatusBadgeProps> = {
  succeeded: { tone: "success", label: "Pago" },
  failed: { tone: "destructive", label: "Falhou" },
  pending: { tone: "warning", label: "Pendente" },
  refunded: { tone: "neutral", label: "Reembolsado" },
};

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

export function RecentPaymentsList({
  payments,
  allPaymentsHref,
}: {
  payments: Payment[];
  allPaymentsHref: string;
}) {
  if (payments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum pagamento registrado. O primeiro Pix ou cobrança no cartão
        aparece aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium tabular-nums">
                {formatMoney(payment.amount, payment.currency)}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {formatPlanLabel(payment.planType)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatNumericDateInSaoPaulo(payment.paidAt ?? payment.createdAt)}
                {" · "}
                {billingProviderLabel(payment.provider)}
                {payment.failureReason ? ` · ${payment.failureReason}` : null}
              </p>
            </div>
            <StatusBadge badge={PAYMENT_BADGES[payment.status]} />
          </li>
        ))}
      </ul>
      <Link
        href={allPaymentsHref}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Ver todos os pagamentos
        <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
