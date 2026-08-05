import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  resolveAutomatizePaymentAmounts,
  resolveProductPaymentAmounts,
  describeAutomatizePaymentSequence,
  type FinanceAutomatizePaymentRow,
  type FinancePaymentsNetBreakdown,
  type FinancePaymentsSummary,
  type FinanceProductPaymentRow,
  type FinancePaymentNetGap,
} from "@/lib/backoffice/finance-payments";
import type { StripeSettlement } from "@/lib/backoffice/finance-dashboard";
import {
  formatBRLFromCentavos,
  formatFinanceDateTime,
  formatFinanceNumber,
} from "@/lib/backoffice/finance-format";
import type { FinancePaymentSource } from "@/lib/backoffice/finance-search-params";
import { formatPlanLabel } from "@/lib/subscriptions/derive";
import { FinancePaymentNetGaps } from "./finance-payment-net-gaps";

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Cartão",
  mercadopago: "PIX",
  manual: "Manual",
};

type FinancePaymentsPanelProps = {
  source: FinancePaymentSource;
  summary: FinancePaymentsSummary;
  automatizePayments?: FinanceAutomatizePaymentRow[];
  stripeSettlements?: StripeSettlement[];
  productPayments?: FinanceProductPaymentRow[];
  netGaps?: FinancePaymentNetGap[];
  backfillQuery?: string;
};

const PRODUCT_NET_LABEL = "Líquido Automatize";
const PRODUCT_NET_HELP =
  "Coprodução quando o produto é nosso; taxa da plataforma quando o produto é de expert.";

function NetSubscriptionBreakdown({
  newSubscriptionNetCentavos,
  renewalNetCentavos,
  newSubscriptionCount,
  renewalCount,
}: FinancePaymentsNetBreakdown) {
  const hasNet = newSubscriptionNetCentavos + renewalNetCentavos > 0;
  const barNew = hasNet ? newSubscriptionNetCentavos : newSubscriptionCount;
  const barRenewal = hasNet ? renewalNetCentavos : renewalCount;
  const barTotal = barNew + barRenewal;

  if (barTotal === 0) {
    return null;
  }

  const newShare = Math.round((barNew / barTotal) * 1000) / 10;
  const renewalShare = Math.round((barRenewal / barTotal) * 1000) / 10;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {barNew > 0 ? (
          <div
            className="h-full bg-chart-1"
            style={{ width: `${newShare}%` }}
            title={`Novos: ${newShare}%`}
          />
        ) : null}
        {barRenewal > 0 ? (
          <div
            className="h-full bg-emerald-500/80"
            style={{ width: `${renewalShare}%` }}
            title={`Renovações: ${renewalShare}%`}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span>
          Novos{" "}
          <span className="font-medium text-foreground">
            {formatBRLFromCentavos(newSubscriptionNetCentavos)}
          </span>
          <span className="ml-1">
            ({formatFinanceNumber(newSubscriptionCount)})
          </span>
        </span>
        <span>
          Renovações{" "}
          <span className="font-medium text-foreground">
            {formatBRLFromCentavos(renewalNetCentavos)}
          </span>
          <span className="ml-1">({formatFinanceNumber(renewalCount)})</span>
        </span>
      </div>
    </div>
  );
}

export function FinancePaymentsPanel({
  source,
  summary,
  automatizePayments = [],
  stripeSettlements = [],
  productPayments = [],
  netGaps = [],
  backfillQuery = "",
}: FinancePaymentsPanelProps) {
  const netIsComplete = summary.netCoveragePayments === summary.count;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Pagamentos aprovados
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {formatFinanceNumber(summary.count)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Total bruto
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {formatBRLFromCentavos(summary.grossCentavos)}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              {source === "produtos" ? PRODUCT_NET_LABEL : "Total líquido"}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {formatBRLFromCentavos(summary.netCentavos)}
            </p>
            {source === "automatize" && summary.netBreakdown ? (
              <NetSubscriptionBreakdown {...summary.netBreakdown} />
            ) : null}
            {source === "produtos" ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {PRODUCT_NET_HELP}
              </p>
            ) : null}
          </div>
        </div>
        {!netIsComplete ? (
          <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            O total líquido está parcial porque o gateway ainda não informou as
            taxas de {summary.count - summary.netCoveragePayments} pagamento
            {summary.count - summary.netCoveragePayments === 1 ? "" : "s"}.
          </p>
        ) : null}
      </section>

      {source === "automatize" && netGaps.length > 0 ? (
        <FinancePaymentNetGaps gaps={netGaps} backfillQuery={backfillQuery} />
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {source === "automatize" ? (
          <AutomatizePaymentsTable
            payments={automatizePayments}
            stripeSettlements={stripeSettlements}
          />
        ) : (
          <ProductPaymentsTable payments={productPayments} />
        )}
      </section>
    </div>
  );
}

function AutomatizePaymentsTable({
  payments,
  stripeSettlements,
}: {
  payments: FinanceAutomatizePaymentRow[];
  stripeSettlements: StripeSettlement[];
}) {
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Data</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Plano</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead>Meio</TableHead>
          <TableHead>Referência</TableHead>
          <TableHead className="text-right">Bruto</TableHead>
          <TableHead className="text-right">Líquido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={8}
              className="h-28 text-center text-muted-foreground"
            >
              Nenhum pagamento aprovado neste período.
            </TableCell>
          </TableRow>
        ) : (
          payments.map((payment) => {
            const stripeSettlement = payment.stripeInvoiceId
              ? settlementsByInvoice.get(payment.stripeInvoiceId)
              : undefined;
            const { gross, net } = resolveAutomatizePaymentAmounts(
              payment,
              stripeSettlement,
            );
            const reference =
              payment.mercadopagoPaymentId ??
              payment.stripeInvoiceId ??
              payment.description;
            const sequence = describeAutomatizePaymentSequence(
              payment.paymentNumber,
            );

            return (
              <TableRow key={payment.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatFinanceDateTime(payment.paidAt)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/users/${payment.userId}?tab=subscription`}
                    className="font-medium hover:underline"
                  >
                    {payment.userEmail}
                  </Link>
                </TableCell>
                <TableCell>{formatPlanLabel(payment.planType)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      sequence.kind === "new_subscription"
                        ? "default"
                        : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {sequence.badgeLabel}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                  {reference ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatBRLFromCentavos(gross)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {net !== null ? formatBRLFromCentavos(net) : "—"}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function ProductPaymentsTable({
  payments,
}: {
  payments: FinanceProductPaymentRow[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Data</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead>Comprador</TableHead>
          <TableHead>Receita</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead className="text-right">Bruto</TableHead>
          <TableHead className="text-right">{PRODUCT_NET_LABEL}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={7}
              className="h-28 text-center text-muted-foreground"
            >
              Nenhuma venda aprovada neste período.
            </TableCell>
          </TableRow>
        ) : (
          payments.map((payment) => {
            const amounts = resolveProductPaymentAmounts(payment);

            return (
              <TableRow key={payment.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatFinanceDateTime(payment.approvedAt ?? payment.createdAt)}
                </TableCell>
                <TableCell className="font-medium">{payment.productTitle}</TableCell>
                <TableCell>
                  <p className="font-medium">{payment.buyerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {payment.buyerEmail}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {amounts.revenueKind === "coproducao"
                      ? "Coprodução"
                      : "Taxa plataforma"}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {payment.providerPaymentId
                    ? `MP ${payment.providerPaymentId}`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatBRLFromCentavos(amounts.grossCentavos)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatBRLFromCentavos(amounts.automatizeNetCentavos)}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
