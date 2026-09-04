import "server-only";

import { eq } from "drizzle-orm";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import {
  listAutomatizePaymentNetGaps,
  type FinanceAutomatizePaymentRow,
} from "@/lib/backoffice/finance-payments";
import type { StripeSettlement } from "@/lib/backoffice/finance-dashboard";
import { getStripeSettlements } from "@/lib/backoffice/stripe-finance-settlement";
import { db } from "@/lib/db";
import { payment } from "@/lib/db/schema";
import { getMercadoPagoPayment, MercadoPagoPaymentNotFoundError } from "@/lib/mercadopago/fetch-payment";
import {
  getMercadoPagoSettlementAmounts,
  hasMercadoPagoSettlementCoverage,
} from "@/lib/mercadopago/settlement";

export type BackfillPaymentSettlementsResult = {
  attempted: number;
  updated: number;
  stillPending: number;
  failed: number;
  errors: string[];
};

export async function backfillAutomatizePaymentSettlements(
  rows: FinanceAutomatizePaymentRow[],
  stripeSettlements: StripeSettlement[],
): Promise<BackfillPaymentSettlementsResult> {
  const gaps = listAutomatizePaymentNetGaps(rows, stripeSettlements);
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );
  const result: BackfillPaymentSettlementsResult = {
    attempted: gaps.length,
    updated: 0,
    stillPending: 0,
    failed: 0,
    errors: [],
  };

  if (gaps.length === 0) {
    return result;
  }

  const stripeInvoiceIds = gaps
    .filter((gap) => gap.provider === "stripe")
    .map((gap) => {
      const row = rows.find((item) => item.id === gap.paymentId);
      return row?.stripeInvoiceId ?? null;
    })
    .filter((value): value is string => Boolean(value));

  const refreshedStripeSettlements = await getStripeSettlements([
    ...new Set(stripeInvoiceIds),
  ]);
  for (const settlement of refreshedStripeSettlements) {
    settlementsByInvoice.set(settlement.invoiceId, settlement);
  }

  for (const gap of gaps) {
    const row = rows.find((item) => item.id === gap.paymentId);
    if (!row) continue;

    try {
      if (row.provider === "stripe" && row.stripeInvoiceId) {
        const settlement = settlementsByInvoice.get(row.stripeInvoiceId);
        if (!settlement) {
          result.stillPending += 1;
          continue;
        }

        await db
          .update(payment)
          .set({
            grossAmount: settlement.grossAmount,
            netAmount: settlement.netAmount,
            feeAmount: settlement.feeAmount,
          })
          .where(eq(payment.id, row.id));
        result.updated += 1;
        continue;
      }

      if (row.provider === "mercadopago" && row.mercadopagoPaymentId) {
        const mpPayment = await getMercadoPagoPayment(row.mercadopagoPaymentId);
        if (!hasMercadoPagoSettlementCoverage(mpPayment)) {
          result.stillPending += 1;
          continue;
        }

        const amounts = getMercadoPagoSettlementAmounts(mpPayment);
        await db
          .update(payment)
          .set({
            grossAmount: amounts.grossAmount,
            netAmount: amounts.netAmount,
            feeAmount: amounts.feeAmount,
          })
          .where(eq(payment.id, row.id));
        result.updated += 1;
        continue;
      }

      result.stillPending += 1;
    } catch (error) {
      if (error instanceof MercadoPagoPaymentNotFoundError) {
        result.stillPending += 1;
        result.errors.push(
          `${gap.paymentId}: pagamento MP ${row.mercadopagoPaymentId ?? "?"} não encontrado em nenhuma conta configurada`,
        );
        continue;
      }

      result.failed += 1;
      const message =
        error instanceof Error ? error.message : "Falha ao atualizar pagamento.";
      result.errors.push(`${gap.paymentId}: ${message}`);
    }
  }

  return result;
}

export async function backfillFinanceAutomatizePaymentSettlements(
  window: DashboardDateWindow,
) {
  const { listFinanceAutomatizePayments } = await import(
    "@/lib/db/finance-payment-queries"
  );
  const { rows, stripeSettlements } =
    await listFinanceAutomatizePayments(window);
  return backfillAutomatizePaymentSettlements(rows, stripeSettlements);
}
