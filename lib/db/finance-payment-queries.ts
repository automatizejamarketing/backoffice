import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import {
  summarizeAutomatizePayments,
  summarizeProductPayments,
  type FinanceAutomatizePaymentRow,
  type FinanceProductPaymentRow,
} from "@/lib/backoffice/finance-payments";
import { db } from "./index";
import {
  expertLedgerEntry,
  payment,
  product,
  productOrder,
  productPayment,
  user,
} from "./schema";

export async function listFinanceAutomatizePayments(window: DashboardDateWindow) {
  const { getStripeSettlements } = await import(
    "@/lib/backoffice/stripe-finance-settlement"
  );

  const rows = await db
    .select({
      id: payment.id,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      userId: payment.userId,
      userEmail: user.email,
      planType: payment.planType,
      provider: payment.provider,
      amount: payment.amount,
      grossAmount: payment.grossAmount,
      netAmount: payment.netAmount,
      feeAmount: payment.feeAmount,
      currency: payment.currency,
      stripeInvoiceId: payment.stripeInvoiceId,
      mercadopagoPaymentId: payment.mercadopagoPaymentId,
      description: payment.description,
      paymentNumber: sql<number>`(
          select count(*)::integer + 1
          from payments earlier_payment
          where earlier_payment.user_id = ${payment.userId}
            and earlier_payment.status = 'succeeded'
            and (
              coalesce(earlier_payment.paid_at, earlier_payment.created_at)
                < coalesce(${payment.paidAt}, ${payment.createdAt})
              or (
                coalesce(earlier_payment.paid_at, earlier_payment.created_at)
                  = coalesce(${payment.paidAt}, ${payment.createdAt})
                and (earlier_payment.created_at, earlier_payment.id)
                  < (${payment.createdAt}, ${payment.id})
              )
            )
        )`,
    })
    .from(payment)
    .innerJoin(user, eq(payment.userId, user.id))
    .where(
      and(
        eq(payment.status, "succeeded"),
        gte(payment.paidAt, window.gte),
        lt(payment.paidAt, window.lt),
      ),
    )
    .orderBy(desc(payment.paidAt));

  const stripeSettlements = await getStripeSettlements(
    rows.flatMap((item) =>
      item.provider === "stripe" && item.stripeInvoiceId
        ? [item.stripeInvoiceId]
        : [],
    ),
  );

  return {
    rows: rows.map(
      (row): FinanceAutomatizePaymentRow => ({
        ...row,
        paymentNumber: Number(row.paymentNumber),
      }),
    ),
    summary: summarizeAutomatizePayments(
      rows.map(
        (row): FinanceAutomatizePaymentRow => ({
          ...row,
          paymentNumber: Number(row.paymentNumber),
        }),
      ),
      stripeSettlements,
    ),
    stripeSettlements,
  };
}

export async function listFinanceProductPayments(window: DashboardDateWindow) {
  const rows = await db
    .select({
      id: productPayment.id,
      orderId: productOrder.id,
      productTitle: productOrder.productTitleSnapshot,
      buyerName: productOrder.buyerName,
      buyerEmail: productOrder.buyerEmail,
      approvedAt: productOrder.approvedAt,
      createdAt: productOrder.createdAt,
      provider: productPayment.provider,
      providerPaymentId: productPayment.providerPaymentId,
      paymentMethodId: productPayment.paymentMethodId,
      paymentTypeId: productPayment.paymentTypeId,
      grossAmountCentavos: productPayment.grossAmountCentavos,
      netAmountCentavos: productPayment.netAmountCentavos,
      feeAmountCentavos: productPayment.feeAmountCentavos,
      priceCentavos: productOrder.priceCentavos,
      ownerType: product.ownerType,
      financialModel: productOrder.financialModel,
      platformFeeBasisPoints: productOrder.platformFeeBasisPoints,
      platformFeeGrossCentavos: productPayment.platformFeeGrossCentavos,
      automatizeCoproductionRevenueCentavos:
        productPayment.automatizeCoproductionRevenueCentavos,
      automatizeProductRevenueCentavos:
        productPayment.automatizeProductRevenueCentavos,
      automatizeTotalNetRevenueCentavos:
        productPayment.automatizeTotalNetRevenueCentavos,
      expertShareBasisPoints: productOrder.ownerExpertShareBasisPoints,
      expertRevenueCentavos: sql<number>`(
          select coalesce(sum(${expertLedgerEntry.amountCentavos}), 0)::integer
          from ${expertLedgerEntry}
          where ${expertLedgerEntry.orderId} = ${productOrder.id}
            and ${expertLedgerEntry.type} = 'sale'
        )`,
    })
    .from(productPayment)
    .innerJoin(productOrder, eq(productPayment.orderId, productOrder.id))
    .innerJoin(product, eq(productOrder.productId, product.id))
    .where(
      and(
        eq(productPayment.status, "approved"),
        isNotNull(productOrder.approvedAt),
        gte(productOrder.approvedAt, window.gte),
        lt(productOrder.approvedAt, window.lt),
      ),
    )
    .orderBy(desc(productOrder.approvedAt));

  return {
    rows: rows.map(
      (row): FinanceProductPaymentRow => ({
        ...row,
        expertRevenueCentavos:
          row.expertRevenueCentavos > 0 ? row.expertRevenueCentavos : null,
      }),
    ),
    summary: summarizeProductPayments(
      rows.map(
        (row): FinanceProductPaymentRow => ({
          ...row,
          expertRevenueCentavos:
            row.expertRevenueCentavos > 0 ? row.expertRevenueCentavos : null,
        }),
      ),
    ),
  };
}
