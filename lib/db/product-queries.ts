import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  productPaymentAttempt,
  productCardDispute,
  productPixFraudCase,
  productPixFraudEvent,
  productEvidenceConsultation,
  productDisputeDefence,
  productDisputeDefenceFile,
  productPostSaleCostCase,
  productReconciliationCase,
  productRefundBalanceCase,
  productRefundOperation,
  productRefundRequest,
  productPurchaseEvidence,
  user,
  type ProductContentType,
} from "./schema";
import {
  buildProductRefundCheckoutSummary,
  getProductRefundBumpOrderIds,
  getProductRefundRootOrderId,
} from "@/lib/products/refund-scope";
import { calculateProductPostSaleCostCase } from "@/lib/products/post-sale-costs";

/** Fila de exceções de conciliação. A leitura não corrige nada: um caso só sai
 * daqui por revisão humana, nunca por decurso de prazo, e jamais por uma
 * transferência que conserte o Split Inicial ou complete um parcial. */
export async function listProductReconciliationCases() {
  return db
    .select({
      id: productReconciliationCase.id,
      orderId: productReconciliationCase.orderId,
      productTitle: productOrder.productTitleSnapshot,
      provider: productReconciliationCase.provider,
      providerAccountId: productReconciliationCase.providerAccountId,
      kind: productReconciliationCase.kind,
      responsible: productReconciliationCase.responsible,
      status: productReconciliationCase.status,
      attributionProven: productReconciliationCase.attributionProven,
      effectiveAmountCentavos: productReconciliationCase.effectiveAmountCentavos,
      evidence: productReconciliationCase.evidence,
      nextReviewAt: productReconciliationCase.nextReviewAt,
      createdAt: productReconciliationCase.createdAt,
    })
    .from(productReconciliationCase)
    .innerJoin(productOrder, eq(productOrder.id, productReconciliationCase.orderId))
    .where(inArray(productReconciliationCase.status, ["open", "monitoring"]))
    .orderBy(asc(productReconciliationCase.nextReviewAt));
}

/** Attempts without a terminal provider fact must remain visible separately
 * from reconciliation cases: they can be explicitly resolved only after an
 * operator records the provider's no-payment fact. */
export async function listProductPaymentAttempts() {
  return db
    .select({
      id: productPaymentAttempt.id,
      orderId: productPaymentAttempt.orderId,
      productTitle: productOrder.productTitleSnapshot,
      attemptKey: productPaymentAttempt.attemptKey,
      paymentMethod: productPaymentAttempt.paymentMethod,
      amountCentavos: productPaymentAttempt.amountCentavos,
      providerPaymentId: productPaymentAttempt.providerPaymentId,
      collectorId: productPaymentAttempt.mercadoPagoCollectorId,
      status: productPaymentAttempt.status,
      failureCode: productPaymentAttempt.failureCode,
      createdAt: productPaymentAttempt.createdAt,
      updatedAt: productPaymentAttempt.updatedAt,
      lastCheckedAt: productPaymentAttempt.lastCheckedAt,
    })
    .from(productPaymentAttempt)
    .innerJoin(productOrder, eq(productOrder.id, productPaymentAttempt.orderId))
    .where(inArray(productPaymentAttempt.status, ["prepared", "issuing", "pending", "unknown"]))
    .orderBy(asc(productPaymentAttempt.updatedAt));
}

/** A read-only operational queue. Submission is intentionally a separate,
 * explicit command so opening this screen can never contact Mercado Pago. */
export async function listProductDisputeDefences() {
  const missingCases = await db
    .select({
      disputeId: productCardDispute.id,
      deadlineAt: productCardDispute.responseDueAt,
      originalProviderAccountId: productCardDispute.providerAccountId,
    })
    .from(productCardDispute)
    .leftJoin(productDisputeDefence, eq(productDisputeDefence.disputeId, productCardDispute.id))
    .where(isNull(productDisputeDefence.id));
  if (missingCases.length > 0) {
    await db
      .insert(productDisputeDefence)
      .values(missingCases)
      .onConflictDoNothing({ target: productDisputeDefence.disputeId });
  }
  const rows = await db
    .select({
      disputeId: productCardDispute.id,
      provider: productCardDispute.provider,
      providerDisputeId: productCardDispute.providerDisputeId,
      caseStatus: productCardDispute.status,
      openedAt: productCardDispute.openedAt,
      defenceId: productDisputeDefence.id,
      deadlineAt: productDisputeDefence.deadlineAt,
      originalProviderAccountId: productDisputeDefence.originalProviderAccountId,
      submissionState: productDisputeDefence.status,
      reviewedAt: productDisputeDefence.reviewedAt,
      reviewedByEmail: productDisputeDefence.reviewedByEmail,
      submittedAt: productDisputeDefence.submittedAt,
      providerResult: productDisputeDefence.providerResult,
      expertNote: productDisputeDefence.expertNote,
      operatorNote: productDisputeDefence.operatorNote,
      lastProviderCheckedAt: productDisputeDefence.lastProviderCheckedAt,
      lastProviderError: productDisputeDefence.lastProviderError,
      productTitle: productOrder.productTitleSnapshot,
    })
    .from(productCardDispute)
    .innerJoin(productOrder, eq(productOrder.id, productCardDispute.orderId))
    .leftJoin(productDisputeDefence, eq(productDisputeDefence.disputeId, productCardDispute.id))
    .orderBy(desc(productCardDispute.openedAt));
  const defenceIds = rows.flatMap((row) => row.defenceId ? [row.defenceId] : []);
  const files = defenceIds.length === 0 ? [] : await db
    .select({ defenceId: productDisputeDefenceFile.defenceId, source: productDisputeDefenceFile.source, fileName: productDisputeDefenceFile.fileName, contentType: productDisputeDefenceFile.contentType, sizeBytes: productDisputeDefenceFile.sizeBytes })
    .from(productDisputeDefenceFile)
    .where(inArray(productDisputeDefenceFile.defenceId, defenceIds));
  return rows.map((row) => ({ ...row, files: files.filter((file) => file.defenceId === row.defenceId) }));
}

/** Operational read model for post-sale obligations and their receipts. */
export async function listProductPostSaleCostCases() {
  const rows = await db
    .select({
      id: productPostSaleCostCase.id,
      productTitle: productOrder.productTitleSnapshot,
      paymentId: productPostSaleCostCase.paymentId,
      provider: productPostSaleCostCase.provider,
      providerAccountId: productPostSaleCostCase.providerAccountId,
      providerCaseId: productPostSaleCostCase.providerCaseId,
      reversal: productPostSaleCostCase.reversal,
      status: productPostSaleCostCase.status,
      responsible: productPostSaleCostCase.responsible,
      evidence: productPostSaleCostCase.evidence,
      createdAt: productPostSaleCostCase.createdAt,
      updatedAt: productPostSaleCostCase.updatedAt,
    })
    .from(productPostSaleCostCase)
    .innerJoin(productPayment, eq(productPayment.id, productPostSaleCostCase.paymentId))
    .innerJoin(productOrder, eq(productOrder.id, productPayment.orderId))
    .orderBy(desc(productPostSaleCostCase.updatedAt));
  return Promise.all(rows.map(async (row) => ({
    ...row,
    ...(await calculateProductPostSaleCostCase(row.id)),
  })));
}

/** Read-only queue for provider-confirmed Pix fraud/MED facts. The queue does
 * not infer fraud from payment status and has no refund or payment action. */
export async function listProductPixFraudCases() {
  const rows = await db
    .select({
      id: productPixFraudCase.id,
      orderId: productPixFraudCase.orderId,
      productTitle: productOrder.productTitleSnapshot,
      buyerEmail: productOrder.buyerEmail,
      provider: productPixFraudCase.provider,
      providerCaseId: productPixFraudCase.providerCaseId,
      providerPaymentId: productPixFraudCase.providerPaymentId,
      providerAccountId: productPixFraudCase.providerAccountId,
      status: productPixFraudCase.status,
      cause: productPixFraudCase.cause,
      responsible: productPixFraudCase.responsible,
      recoveredAmountCentavos: productPixFraudCase.recoveredAmountCentavos,
      financialPending: productPixFraudCase.financialPending,
      observedAt: productPixFraudCase.observedAt,
      resolvedAt: productPixFraudCase.resolvedAt,
      responseDueAt: productPixFraudCase.responseDueAt,
    })
    .from(productPixFraudCase)
    .innerJoin(productOrder, eq(productOrder.id, productPixFraudCase.orderId))
    .orderBy(desc(productPixFraudCase.observedAt));
  const caseIds = rows.map((row) => row.id);
  const events = caseIds.length
    ? await db
        .select({
          caseId: productPixFraudEvent.caseId,
          providerEventId: productPixFraudEvent.providerEventId,
          eventType: productPixFraudEvent.eventType,
          occurredAt: productPixFraudEvent.occurredAt,
        })
        .from(productPixFraudEvent)
        .where(inArray(productPixFraudEvent.caseId, caseIds))
        .orderBy(desc(productPixFraudEvent.occurredAt))
    : [];
  return rows.map((row) => ({
    ...row,
    events: events.filter((event) => event.caseId === row.id),
  }));
}

/** Explicitly authorized evidence read for operations/defence work. The
 * consultation itself is recorded in the shared audit table. */
export async function listProductPurchaseEvidenceForOperator(input: {
  orderId: string;
  operatorEmail: string;
}) {
  const [order] = await db
    .select({ id: productOrder.id })
    .from(productOrder)
    .where(eq(productOrder.id, input.orderId))
    .limit(1);
  if (!order) return [];
  await db.insert(productEvidenceConsultation).values({
    orderId: input.orderId,
    viewerKind: "operator",
    viewerEmail: input.operatorEmail,
    purpose: "backoffice_dispute_defence",
  });
  return db
    .select({
      orderId: productPurchaseEvidence.orderId,
      productId: productPurchaseEvidence.productId,
      contentItemId: productPurchaseEvidence.contentItemId,
      eventType: productPurchaseEvidence.eventType,
      accessSource: productPurchaseEvidence.accessSource,
      context: productPurchaseEvidence.context,
      occurredAt: productPurchaseEvidence.occurredAt,
    })
    .from(productPurchaseEvidence)
    .where(eq(productPurchaseEvidence.orderId, input.orderId))
    .orderBy(asc(productPurchaseEvidence.occurredAt));
}
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

/** Operational queue only. Executing a refund remains an explicit, audited action. */
export async function listProductRefundRequests() {
  const requests = await db
    .select({
      id: productRefundRequest.id,
      protocol: productRefundRequest.protocol,
      status: productRefundRequest.status,
      requestedAt: productRefundRequest.requestedAt,
      orderId: productOrder.id,
      buyerUserId: productRefundRequest.buyerUserId,
      buyerEmail: productOrder.buyerEmail,
      buyerName: productOrder.buyerName,
      productTitle: productOrder.productTitleSnapshot,
      amountCentavos: productOrder.priceCentavos,
      attribution: productOrder.attribution,
    })
    .from(productRefundRequest)
    .innerJoin(productOrder, eq(productOrder.id, productRefundRequest.orderId))
    .orderBy(desc(productRefundRequest.requestedAt));

  const orderIds = requests.flatMap((request) => [
    request.orderId,
    ...getProductRefundBumpOrderIds(request.attribution),
  ]);
  const orders = orderIds.length
    ? await db
        .select({
          id: productOrder.id,
          productTitle: productOrder.productTitleSnapshot,
          priceCentavos: productOrder.priceCentavos,
        })
        .from(productOrder)
        .where(inArray(productOrder.id, [...new Set(orderIds)]))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  return requests.map((request) => {
    const ids = [
      request.orderId,
      ...getProductRefundBumpOrderIds(request.attribution),
    ];
    const checkoutOrders = ids
      .map((id) => ordersById.get(id))
      .filter((order): order is (typeof orders)[number] => Boolean(order));
    const totalCentavos = checkoutOrders.reduce(
      (total, order) => total + order.priceCentavos,
      0,
    );
    return {
      ...request,
      amountCentavos: totalCentavos || request.amountCentavos,
      totalCentavos: totalCentavos || request.amountCentavos,
      items: checkoutOrders.map((order) => ({
        orderId: order.id,
        title: order.productTitle,
        amountCentavos: order.priceCentavos,
      })),
    };
  });
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
      stripeAccountId: expertProfile.stripeAccountId,
      stripeChargesEnabled: expertProfile.stripeChargesEnabled,
      stripePayoutsEnabled: expertProfile.stripePayoutsEnabled,
      stripeDetailsSubmitted: expertProfile.stripeDetailsSubmitted,
      stripeAccountUpdatedAt: expertProfile.stripeAccountUpdatedAt,
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
        provider: productPayment.provider,
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
  type: ProductContentType;
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
  const rows = await db
    .select({
      id: productOrder.id,
      productId: productOrder.productId,
      productTitle: productOrder.productTitleSnapshot,
      buyerName: productOrder.buyerName,
      buyerEmail: productOrder.buyerEmail,
      priceCentavos: productOrder.priceCentavos,
      attribution: productOrder.attribution,
      status: productOrder.status,
      approvedAt: productOrder.approvedAt,
      createdAt: productOrder.createdAt,
      checkoutChannel: productOrder.checkoutChannel,
      marketplaceFeeBasisPoints: productOrder.marketplaceFeeBasisPoints,
      buyerUserId: productOrder.userId,
      provider: productPayment.provider,
      providerPaymentId: productPayment.providerPaymentId,
      stripeAccountId: productPayment.stripeAccountId,
      expertSettlement: productPayment.expertSettlement,
      financialModel: productOrder.financialModel,
      coproducerShareBasisPoints: productOrder.coproducerShareBasisPoints,
      coproducerTypeSnapshot: productOrder.coproducerTypeSnapshot,
      gatewayFeeEstimateBps: productOrder.gatewayFeeEstimateBps,
      gatewayFeeEstimateFixedCentavos:
        productOrder.gatewayFeeEstimateFixedCentavos,
      ownerType: product.ownerType,
      ownerExpertShareBasisPoints: productOrder.ownerExpertShareBasisPoints,
      platformFeeBasisPoints: productOrder.platformFeeBasisPoints,
      platformFeeFixedCentavos: productOrder.platformFeeFixedCentavos,
      paymentStatus: productPayment.status,
      refundOperationId: productRefundOperation.id,
      refundOperationStatus: productRefundOperation.status,
      refundOperationAmountCentavos: productRefundOperation.refundedAmountCentavos,
      refundOperationReason: productRefundOperation.reason,
      refundOperationOperatorEmail: productRefundOperation.operatorEmail,
      refundOperationUpdatedAt: productRefundOperation.updatedAt,
      refundBalanceCaseId: productRefundBalanceCase.id,
      refundBalanceStatus: productRefundBalanceCase.status,
      refundBalanceResponsible: productRefundBalanceCase.responsible,
      refundBalanceFirstFailedAt: productRefundBalanceCase.firstFailedAt,
      refundBalanceLastFailedAt: productRefundBalanceCase.lastFailedAt,
      refundBalanceDueAt: productRefundBalanceCase.regularizationDueAt,
      refundBalanceAttemptCount: productRefundBalanceCase.attemptCount,
      refundBalanceNextRetryAt: productRefundBalanceCase.nextRetryAt,
      refundBalanceNoticeSentAt: productRefundBalanceCase.noticeSentAt,
      refundBalanceLastFailureCode: productRefundBalanceCase.lastFailureCode,
      refundBalanceLastFailureMessage: productRefundBalanceCase.lastFailureMessage,
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
    .innerJoin(product, eq(productOrder.productId, product.id))
    .leftJoin(productPayment, eq(productPayment.orderId, productOrder.id))
    .leftJoin(productRefundOperation, eq(productRefundOperation.paymentId, productPayment.id))
    .leftJoin(productRefundBalanceCase, eq(productRefundBalanceCase.paymentId, productPayment.id))
    .orderBy(desc(productOrder.createdAt));

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const rootOrderId = getProductRefundRootOrderId(row);
    const root = rowsById.get(rootOrderId) ?? row;
    const bumpRows = getProductRefundBumpOrderIds(root.attribution)
      .map((id) => rowsById.get(id))
      .filter((item): item is (typeof row) => Boolean(item));
    const summary = buildProductRefundCheckoutSummary(
      { id: root.id, productTitle: root.productTitle, priceCentavos: root.priceCentavos },
      bumpRows.map((item) => ({ id: item.id, productTitle: item.productTitle, priceCentavos: item.priceCentavos })),
    );
    return {
      ...row,
      checkoutRootOrderId: root.id,
      checkoutOrderIds: summary.orderIds,
      checkoutItems: summary.items,
      checkoutTotalCentavos: summary.totalCentavos,
      checkoutProvider: root.provider,
    };
  });
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

/**
 * Commits the local consequences of an already provider-confirmed integral
 * refund.  Orders, entitlements, ledger reversals, payment state, operation,
 * and buyer request are one transaction so a bump can never be left active
 * while the principal order is marked refunded.
 */
export async function applyFullProductCheckoutRefund(input: {
  orderIds: string[];
  rootOrderId: string;
  paymentId: string;
  refundedAmountCentavos: number;
  operationId?: string;
  eventSuffix: string;
}) {
  const orderIds = [...new Set(input.orderIds)];
  if (!orderIds.length || !orderIds.includes(input.rootOrderId)) {
    throw new Error("invalid_product_checkout_group");
  }
  return db.transaction(async (tx) => {
    const orders = await tx
      .select()
      .from(productOrder)
      .where(inArray(productOrder.id, orderIds))
      .for("update");
    if (orders.length !== orderIds.length) {
      throw new Error("invalid_product_checkout_group");
    }
    if (orders.some((order) => !["approved", "refunded"].includes(order.status))) {
      throw new Error("checkout_not_approved");
    }

    const now = new Date();
    await tx
      .update(productEntitlement)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(productEntitlement.orderId, orderIds),
          isNull(productEntitlement.revokedAt),
        ),
      );
    const approvedOrderIds = orders
      .filter((order) => order.status === "approved")
      .map((order) => order.id);
    if (approvedOrderIds.length) {
      await tx
        .update(productOrder)
        .set({ status: "refunded", refundedAt: now, updatedAt: now })
        .where(inArray(productOrder.id, approvedOrderIds));
    }

    const [payment] = await tx
      .select()
      .from(productPayment)
      .where(
        and(
          eq(productPayment.id, input.paymentId),
          eq(productPayment.orderId, input.rootOrderId),
        ),
      )
      .limit(1);
    if (!payment) throw new Error("refund_payment_not_found");
    await tx
      .update(productPayment)
      .set({
        status: "refunded",
        refundedAmountCentavos: input.refundedAmountCentavos,
        platformGatewayNetRevenueCentavos: 0,
        ownerExpertReceivableCentavos: 0,
        coproducerExpertReceivableCentavos: 0,
        automatizeCoproductionRevenueCentavos: 0,
        automatizeProductRevenueCentavos: 0,
        automatizeTotalNetRevenueCentavos: 0,
        updatedAt: now,
      })
      .where(eq(productPayment.id, input.paymentId));

    for (const orderId of approvedOrderIds) {
      const sales = await tx
        .select()
        .from(expertLedgerEntry)
        .where(
          and(
            eq(expertLedgerEntry.orderId, orderId),
            eq(expertLedgerEntry.type, "sale"),
          ),
        );
      for (const sale of sales) {
        await tx
          .insert(expertLedgerEntry)
          .values({
            expertId: sale.expertId,
            orderId,
            eventKey: `product-refund:${orderId}:${sale.id}:${input.eventSuffix}`,
            type: "refund",
            amountCentavos: -sale.amountCentavos,
            availableAt: now,
            description: `Estorno de ${orders.find((order) => order.id === orderId)?.productTitleSnapshot ?? "produto"}`,
          })
          .onConflictDoNothing({ target: expertLedgerEntry.eventKey });
      }
    }

    if (input.operationId) {
      await tx
        .update(productRefundOperation)
        .set({
          status: "confirmed",
          refundedAmountCentavos: input.refundedAmountCentavos,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(productRefundOperation.id, input.operationId));
    }
    await tx
      .update(productRefundBalanceCase)
      .set({ nextRetryAt: null, lastFailureMessage: null, updatedAt: now })
      .where(and(
        eq(productRefundBalanceCase.paymentId, input.paymentId),
        eq(productRefundBalanceCase.status, "pending"),
      ));
    await tx
      .update(productRefundRequest)
      .set({ status: "completed", updatedAt: now })
      .where(
        and(
          eq(productRefundRequest.orderId, input.rootOrderId),
          inArray(productRefundRequest.status, ["requested", "in_review"]),
        ),
      );
    return { orders, payment, refundedAmountCentavos: input.refundedAmountCentavos };
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
      .set({
        status: "refunded",
        // A devolução ao cliente é manual (Pix), então nossa receita e os
        // recebíveis de expert deste pagamento viram zero. Bruto e Custo MP
        // ficam: o custo do provedor foi pago de verdade e não volta.
        platformGatewayNetRevenueCentavos: 0,
        ownerExpertReceivableCentavos: 0,
        coproducerExpertReceivableCentavos: 0,
        automatizeCoproductionRevenueCentavos: 0,
        automatizeProductRevenueCentavos: 0,
        automatizeTotalNetRevenueCentavos: 0,
        updatedAt: now,
      })
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
