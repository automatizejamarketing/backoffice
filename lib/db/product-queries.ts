import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import {
  expertLedgerEntry,
  expertPayoutRequest,
  expertProfile,
  product,
  productContentItem,
  productEntitlement,
  productFinancialSetting,
  productOrder,
  productPayment,
  user,
} from "./schema";
import { parseProductAdminInput } from "@/lib/products/admin-input";
import { parseProductContentInput } from "@/lib/products/content-input";
import { parseExpertAdminInput } from "@/lib/products/expert-input";
import {
  canTransitionPayout,
  type ExpertPayoutStatus,
} from "@/lib/products/payout";
import { summarizeProductPaymentsByProduct } from "@/lib/backoffice/finance-payments";
import { parseProductFinancialSettingsInput } from "@/lib/products/financial-settings";

export async function getProductFinancialSettings() {
  const [settings] = await db
    .select()
    .from(productFinancialSetting)
    .where(eq(productFinancialSetting.id, "default"))
    .limit(1);

  return {
    platformFeeBasisPoints: settings?.platformFeeBasisPoints ?? 500,
  };
}

export async function updateProductFinancialSettings(input: unknown) {
  const values = parseProductFinancialSettingsInput(input);
  const [settings] = await db
    .insert(productFinancialSetting)
    .values({ id: "default", ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: productFinancialSetting.id,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return settings;
}

export async function listExperts() {
  return db
    .select({
      id: expertProfile.id,
      userId: expertProfile.userId,
      displayName: expertProfile.displayName,
      profileImageUrl: expertProfile.profileImageUrl,
      email: user.email,
      phone: expertProfile.phone,
      pixKey: expertProfile.pixKey,
      platformFeeBasisPoints: expertProfile.platformFeeBasisPoints,
      platformFeeFixedCentavos: expertProfile.platformFeeFixedCentavos,
      marketplaceFeeBasisPoints: expertProfile.marketplaceFeeBasisPoints,
      status: expertProfile.status,
    })
    .from(expertProfile)
    .innerJoin(user, eq(expertProfile.userId, user.id))
    .orderBy(asc(expertProfile.displayName));
}

export async function createExpert(input: {
  email: string;
  displayName: string;
  profileImageUrl?: string | null;
  phone?: string | null;
  pixKey: string;
  platformFeePercent?: number;
  platformFeeFixedCentavos?: number;
  marketplaceFeePercent?: number;
}) {
  const email = input.email.trim().toLowerCase();
  const values = parseExpertAdminInput(input);
  const [appUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!appUser) throw new Error("Usuário do Automatize não encontrado");
  const [created] = await db
    .insert(expertProfile)
    .values({
      userId: appUser.id,
      ...values,
    })
    .returning();
  return created;
}

export async function updateExpert(id: string, input: unknown) {
  const values = parseExpertAdminInput(input);
  const [updated] = await db
    .update(expertProfile)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(expertProfile.id, id))
    .returning();
  return updated ?? null;
}

export async function listProductsAdmin() {
  const [products, paymentRows] = await Promise.all([
    db
      .select({
        product,
        expertName: expertProfile.displayName,
      })
      .from(product)
      .leftJoin(expertProfile, eq(product.expertId, expertProfile.id))
      .orderBy(desc(product.createdAt)),
    db
      .select({
        productId: productOrder.productId,
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
        expertRevenueCentavos: sql<number>`(
          select coalesce(sum(${expertLedgerEntry.amountCentavos}), 0)::integer
          from ${expertLedgerEntry}
          where ${expertLedgerEntry.orderId} = ${productOrder.id}
            and ${expertLedgerEntry.type} = 'sale'
        )`,
      })
      .from(productOrder)
      .innerJoin(productPayment, eq(productPayment.orderId, productOrder.id))
      .innerJoin(product, eq(productOrder.productId, product.id))
      .where(
        and(
          eq(productOrder.status, "approved"),
          eq(productPayment.status, "approved"),
        ),
      ),
  ]);

  const financialsByProduct = summarizeProductPaymentsByProduct(
    paymentRows.map((row) => ({
      ...row,
      expertRevenueCentavos:
        row.expertRevenueCentavos > 0 ? row.expertRevenueCentavos : null,
    })),
  );

  return products.map((row) => ({
    ...row,
    ...(financialsByProduct.get(row.product.id) ?? {
      grossRevenueCentavos: 0,
      automatizeNetRevenueCentavos: 0,
    }),
  }));
}

export async function createProductAdmin(input: unknown) {
  const values = parseProductAdminInput(input);
  const [created] = await db.insert(product).values(values).returning();
  return created;
}

export async function productExistsAdmin(id: string) {
  const [row] = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.id, id))
    .limit(1);
  return Boolean(row);
}

export async function updateProductAdmin(id: string, input: unknown) {
  const values = parseProductAdminInput(input);
  const [updated] = await db
    .update(product)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(product.id, id))
    .returning();
  return updated ?? null;
}

export async function archiveProductAdmin(id: string) {
  const [updated] = await db
    .update(product)
    .set({ status: "archived", salesEnabled: false, updatedAt: new Date() })
    .where(eq(product.id, id))
    .returning();
  return updated ?? null;
}

export async function listProductContent(productId: string) {
  return db
    .select()
    .from(productContentItem)
    .where(eq(productContentItem.productId, productId))
    .orderBy(asc(productContentItem.position));
}

export async function createProductContent(input: {
  productId: string;
  type: "video" | "pdf" | "file" | "external_link";
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  blobPathname?: string | null;
  videoProvider?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  position: number;
  published?: boolean;
}) {
  const values = parseProductContentInput(input);
  const [created] = await db
    .insert(productContentItem)
    .values({
      ...values,
    })
    .returning();
  return created;
}

export async function updateProductContent(
  id: string,
  input: Parameters<typeof createProductContent>[0],
) {
  const values = parseProductContentInput(input);
  const [updated] = await db
    .update(productContentItem)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(productContentItem.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteProductContent(id: string) {
  const [deleted] = await db
    .delete(productContentItem)
    .where(eq(productContentItem.id, id))
    .returning();
  return deleted ?? null;
}

export async function listProductOrders() {
  return db
    .select({
      id: productOrder.id,
      productId: productOrder.productId,
      productTitle: productOrder.productTitleSnapshot,
      buyerName: productOrder.buyerName,
      buyerEmail: productOrder.buyerEmail,
      priceCentavos: productOrder.priceCentavos,
      status: productOrder.status,
      approvedAt: productOrder.approvedAt,
      createdAt: productOrder.createdAt,
      checkoutChannel: productOrder.checkoutChannel,
      marketplaceFeeBasisPoints: productOrder.marketplaceFeeBasisPoints,
      providerPaymentId: productPayment.providerPaymentId,
      paymentStatus: productPayment.status,
      grossAmountCentavos: productPayment.grossAmountCentavos,
      netAmountCentavos: productPayment.netAmountCentavos,
      feeAmountCentavos: productPayment.feeAmountCentavos,
      paymentMethodId: productPayment.paymentMethodId,
      paymentTypeId: productPayment.paymentTypeId,
      providerReleaseAt: productPayment.providerReleaseAt,
      platformFeeGrossCentavos: productPayment.platformFeeGrossCentavos,
      platformGatewayNetRevenueCentavos:
        productPayment.platformGatewayNetRevenueCentavos,
      ownerExpertReceivableCentavos:
        productPayment.ownerExpertReceivableCentavos,
      coproducerExpertReceivableCentavos:
        productPayment.coproducerExpertReceivableCentavos,
      automatizeCoproductionRevenueCentavos:
        productPayment.automatizeCoproductionRevenueCentavos,
      automatizeProductRevenueCentavos:
        productPayment.automatizeProductRevenueCentavos,
      automatizeTotalNetRevenueCentavos:
        productPayment.automatizeTotalNetRevenueCentavos,
      expertAvailableAt: sql<Date | null>`(
        select min(${expertLedgerEntry.availableAt})
        from ${expertLedgerEntry}
        where ${expertLedgerEntry.orderId} = ${productOrder.id}
          and ${expertLedgerEntry.type} = 'sale'
      )`,
      expertLedgerAmountCentavos: sql<number | null>`(
        select sum(${expertLedgerEntry.amountCentavos})
        from ${expertLedgerEntry}
        where ${expertLedgerEntry.orderId} = ${productOrder.id}
          and ${expertLedgerEntry.type} = 'sale'
      )`,
    })
    .from(productOrder)
    .leftJoin(productPayment, eq(productPayment.orderId, productOrder.id))
    .orderBy(desc(productOrder.createdAt));
}

export async function listPayoutRequests() {
  return db
    .select({
      id: expertPayoutRequest.id,
      expertId: expertPayoutRequest.expertId,
      expertName: expertProfile.displayName,
      amountCentavos: expertPayoutRequest.amountCentavos,
      pixKeySnapshot: expertPayoutRequest.pixKeySnapshot,
      status: expertPayoutRequest.status,
      dueAt: expertPayoutRequest.dueAt,
      proofUrl: expertPayoutRequest.proofUrl,
      createdAt: expertPayoutRequest.createdAt,
    })
    .from(expertPayoutRequest)
    .innerJoin(expertProfile, eq(expertPayoutRequest.expertId, expertProfile.id))
    .orderBy(desc(expertPayoutRequest.createdAt));
}

export async function updatePayoutRequest({
  id,
  status,
  proofUrl,
  adminEmail,
}: {
  id: string;
  status: Exclude<ExpertPayoutStatus, "requested">;
  proofUrl?: string | null;
  adminEmail: string;
}) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(expertPayoutRequest)
      .where(eq(expertPayoutRequest.id, id))
      .limit(1)
      .for("update");
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.status === "paid") return request;
    if (
      !canTransitionPayout(
        request.status as ExpertPayoutStatus,
        status,
      )
    ) {
      throw new Error(
        `Transição de repasse inválida: ${request.status} → ${status}`,
      );
    }
    if (status === "paid" && !(proofUrl || request.proofUrl)) {
      throw new Error("Informe o comprovante antes de registrar o pagamento");
    }
    if (proofUrl) {
      try {
        if (new URL(proofUrl).protocol !== "https:") throw new Error();
      } catch {
        throw new Error("O comprovante deve usar uma URL HTTPS válida");
      }
    }

    const now = new Date();
    const [updated] = await tx
      .update(expertPayoutRequest)
      .set({
        status,
        proofUrl: proofUrl || request.proofUrl,
        adminEmail,
        reviewedAt: now,
        paidAt: status === "paid" ? now : null,
        updatedAt: now,
      })
      .where(eq(expertPayoutRequest.id, id))
      .returning();

    if (status === "paid") {
      await tx
        .insert(expertLedgerEntry)
        .values({
          expertId: request.expertId,
          eventKey: `expert-payout:${request.id}`,
          type: "payout",
          amountCentavos: -request.amountCentavos,
          availableAt: now,
          description: `Saque ${request.id}`,
        })
        .onConflictDoNothing({ target: expertLedgerEntry.eventKey });
    }
    return updated;
  });
}

export async function applyFullProductRefund(
  orderId: string,
  eventSuffix: string,
) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(productOrder)
      .where(eq(productOrder.id, orderId))
      .limit(1)
      .for("update");
    if (!order) throw new Error("Pedido não encontrado");
    if (order.status === "refunded") return order;
    if (order.status !== "approved") throw new Error("Pedido não está aprovado");
    const now = new Date();
    await tx
      .update(productEntitlement)
      .set({ revokedAt: now })
      .where(
        and(
          eq(productEntitlement.orderId, order.id),
          isNull(productEntitlement.revokedAt),
        ),
      );
    await tx
      .update(productPayment)
      .set({ status: "refunded", updatedAt: now })
      .where(eq(productPayment.orderId, order.id));
    const [updated] = await tx
      .update(productOrder)
      .set({ status: "refunded", refundedAt: now, updatedAt: now })
      .where(eq(productOrder.id, order.id))
      .returning();

    const sales = await tx
      .select()
      .from(expertLedgerEntry)
      .where(
        and(
          eq(expertLedgerEntry.orderId, order.id),
          eq(expertLedgerEntry.type, "sale"),
        ),
      );
    for (const sale of sales) {
      await tx
        .insert(expertLedgerEntry)
        .values({
          expertId: sale.expertId,
          orderId: order.id,
          eventKey: `product-refund:${order.id}:${sale.id}:${eventSuffix}`,
          type: "refund",
          amountCentavos: -sale.amountCentavos,
          availableAt: now,
          description: `Estorno de ${order.productTitleSnapshot}`,
        })
        .onConflictDoNothing({ target: expertLedgerEntry.eventKey });
    }
    return updated;
  });
}
