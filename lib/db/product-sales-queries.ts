import { and, asc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { product, productOrder, productPayment } from "@/lib/db/schema";
import type { ProductSalesOrderRow } from "@/lib/backoffice/product-sales-dashboard";

/**
 * Pedidos que tocam a janela por qualquer uma das três datas que o painel
 * usa: criação (coorte de tentativa), aprovação (venda) e reembolso. Quem
 * recorta cada métrica pela data certa é `buildProductSalesDashboard`.
 */
export async function listProductSalesRows({
  gte: from,
  lt: to,
  productIds,
}: {
  gte: Date;
  lt: Date;
  /** Vazio é "todos". */
  productIds?: string[];
}): Promise<ProductSalesOrderRow[]> {
  const inWindow = (column: AnyPgColumn) =>
    and(gte(column, from), lt(column, to)) as SQL;

  const rows = await db
    .select({
      orderId: productOrder.id,
      productId: productOrder.productId,
      productTitle: productOrder.productTitleSnapshot,
      buyerName: productOrder.buyerName,
      buyerEmail: productOrder.buyerEmail,
      createdAt: productOrder.createdAt,
      approvedAt: productOrder.approvedAt,
      refundedAt: productOrder.refundedAt,
      orderStatus: productOrder.status,
      paymentStatus: productPayment.status,
      provider: productPayment.provider,
      paymentMethodId: productPayment.paymentMethodId,
      paymentTypeId: productPayment.paymentTypeId,
      grossAmountCentavos: productPayment.grossAmountCentavos,
      netAmountCentavos: productPayment.netAmountCentavos,
      feeAmountCentavos: productPayment.feeAmountCentavos,
      priceCentavos: productOrder.priceCentavos,
      ownerType: product.ownerType,
      financialModel: productOrder.financialModel,
      platformFeeBasisPoints: productOrder.platformFeeBasisPoints,
      platformFeeFixedCentavos: productOrder.platformFeeFixedCentavos,
      platformFeeGrossCentavos: productPayment.platformFeeGrossCentavos,
      automatizeCoproductionRevenueCentavos:
        productPayment.automatizeCoproductionRevenueCentavos,
      automatizeProductRevenueCentavos:
        productPayment.automatizeProductRevenueCentavos,
      automatizeTotalNetRevenueCentavos:
        productPayment.automatizeTotalNetRevenueCentavos,
      expertShareBasisPoints: productOrder.ownerExpertShareBasisPoints,
      coproducerShareBasisPoints: productOrder.coproducerShareBasisPoints,
      coproducerTypeSnapshot: productOrder.coproducerTypeSnapshot,
      expertSettlement: productPayment.expertSettlement,
      ownerExpertReceivableCentavos:
        productPayment.ownerExpertReceivableCentavos,
      gatewayFeeEstimateBps: productOrder.gatewayFeeEstimateBps,
      gatewayFeeEstimateFixedCentavos:
        productOrder.gatewayFeeEstimateFixedCentavos,
    })
    .from(productOrder)
    .innerJoin(product, eq(productOrder.productId, product.id))
    .leftJoin(productPayment, eq(productPayment.orderId, productOrder.id))
    .where(
      and(
        or(
          inWindow(productOrder.createdAt),
          inWindow(productOrder.approvedAt),
          inWindow(productOrder.refundedAt),
        ),
        productIds && productIds.length > 0
          ? inArray(productOrder.productId, productIds)
          : undefined,
      ),
    );

  return rows.map((row) => ({
    ...row,
    provider: row.provider ?? "",
    expertRevenueCentavos: null,
  }));
}

export async function listProductSalesFilterOptions() {
  return db
    .select({ id: product.id, title: product.title })
    .from(product)
    .orderBy(asc(product.title));
}
