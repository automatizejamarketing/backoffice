import { and, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  productOrder,
  productPayment,
  productPostSaleCostCase,
  productPostSaleCostMovement,
  productPostSaleCostSettlement,
  type ProductOrder,
} from "@/lib/db/schema";
import {
  ORDER_BUMP_ORDER_IDS_ATTRIBUTION_KEY,
  ORDER_BUMP_PARENT_ORDER_ID_KEY,
  parseOrderBumpOrderIds,
} from "@/lib/products/order-bumps";
import { apportionPostSaleCosts } from "@/lib/products/post-sale-cost-settlement";

type QueryExecutor = Pick<typeof db, "select">;
type ProductPostSaleCostMovement = typeof productPostSaleCostMovement.$inferSelect;
type ProductPostSaleCostSettlement = typeof productPostSaleCostSettlement.$inferSelect;
type PostSaleCostCalculation = ReturnType<typeof apportionPostSaleCosts>;

async function checkoutOrders(executor: QueryExecutor, order: ProductOrder) {
  const parentId = order.attribution?.[ORDER_BUMP_PARENT_ORDER_ID_KEY];
  const root = parentId
    ? (await executor.select().from(productOrder).where(eq(productOrder.id, parentId)).limit(1))[0]
    : order;
  if (!root) throw new Error("post_sale_cost_root_order_not_found");
  const bumpIds = parseOrderBumpOrderIds(root.attribution?.[ORDER_BUMP_ORDER_IDS_ATTRIBUTION_KEY]);
  const bumps = bumpIds.length
    ? await executor.select().from(productOrder).where(inArray(productOrder.id, bumpIds))
    : [];
  const byId = new Map(bumps.map((item) => [item.id, item]));
  const ordered = bumpIds.map((id) => byId.get(id));
  if (ordered.some((item) => !item || item.buyerEmail !== root.buyerEmail || item.currency !== root.currency)) {
    throw new Error("post_sale_cost_checkout_group_invalid");
  }
  return [root, ...(ordered as ProductOrder[])];
}

function calculationItems(orders: ProductOrder[]) {
  return orders.map((order) => ({
    orderId: order.id,
    commercialPriceCentavos: order.priceCentavos,
    expertShareBasisPoints: order.ownerExpertShareBasisPoints,
  }));
}

function movementInput(movements: ProductPostSaleCostMovement[]) {
  return movements.map((movement) => ({
    id: movement.providerMovementId,
    kind: movement.kind,
    attribution: movement.attribution,
    orderId: movement.orderId ?? undefined,
    amountCentavos: movement.amountCentavos,
    supportedBy: movement.supportedBy,
  }));
}

type PostSaleSettlementSnapshot = {
  orders: ReturnType<typeof calculationItems>;
  movements: Array<{
    providerMovementId: string;
    kind: string;
    attribution: string;
    orderId: string | null;
    amountCentavos: number;
    supportedBy: string;
    observedAt: string;
  }>;
  calculation: PostSaleCostCalculation;
};

function buildSettlementSnapshot(
  orders: ProductOrder[],
  movements: ProductPostSaleCostMovement[],
  calculation: PostSaleCostCalculation,
): PostSaleSettlementSnapshot {
  return {
    orders: calculationItems(orders),
    movements: [...movements]
      .sort((left, right) => left.providerMovementId.localeCompare(right.providerMovementId))
      .map((movement) => ({
        providerMovementId: movement.providerMovementId,
        kind: movement.kind,
        attribution: movement.attribution,
        orderId: movement.orderId,
        amountCentavos: movement.amountCentavos,
        supportedBy: movement.supportedBy,
        observedAt: movement.observedAt.toISOString(),
      })),
    calculation,
  };
}

function hashSettlementSnapshot(snapshot: PostSaleSettlementSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function lockPostSaleCostCase(tx: Pick<typeof db, "select">, caseId: string) {
  const [row] = await tx
    .select({ id: productPostSaleCostCase.id })
    .from(productPostSaleCostCase)
    .where(eq(productPostSaleCostCase.id, caseId))
    .for("update");
  if (!row) throw new Error("post_sale_cost_case_not_found");
}

async function calculateProductPostSaleCostCaseWithExecutor(executor: QueryExecutor, caseId: string) {
  const [row] = await executor
    .select({ case: productPostSaleCostCase, payment: productPayment, order: productOrder })
    .from(productPostSaleCostCase)
    .innerJoin(productPayment, eq(productPayment.id, productPostSaleCostCase.paymentId))
    .innerJoin(productOrder, eq(productOrder.id, productPayment.orderId))
    .where(eq(productPostSaleCostCase.id, caseId))
    .limit(1);
  if (!row) throw new Error("post_sale_cost_case_not_found");
  const orders = await checkoutOrders(executor, row.order);
  const movements = await executor
    .select()
    .from(productPostSaleCostMovement)
    .where(eq(productPostSaleCostMovement.caseId, caseId));
  const calculation = apportionPostSaleCosts({
    reversal: row.case.reversal,
    items: calculationItems(orders),
    movements: movementInput(movements),
  });
  const settlement = (await executor
    .select()
    .from(productPostSaleCostSettlement)
    .where(eq(productPostSaleCostSettlement.caseId, caseId))
    .limit(1))[0] ?? null;
  const snapshot = buildSettlementSnapshot(orders, movements, calculation);
  return {
    ...row,
    orders,
    movements,
    calculation,
    settlement,
    snapshot,
    movementSnapshotHash: hashSettlementSnapshot(snapshot),
  };
}

export async function calculateProductPostSaleCostCase(caseId: string) {
  return db.transaction(async (tx) => {
    await lockPostSaleCostCase(tx, caseId);
    return calculateProductPostSaleCostCaseWithExecutor(tx, caseId);
  });
}

/** Confirms an already executed manual transfer; this route never moves money. */
export async function confirmProductPostSaleCostSettlement(input: {
  caseId: string;
  operatorUserId?: string | null;
  operatorEmail: string;
  proofUrl: string;
  proofKey: string;
}) {
  if (!input.operatorEmail.trim() || !input.proofUrl.trim() || !input.proofKey.trim()) {
    throw new Error("post_sale_cost_settlement_proof_required");
  }
  return db.transaction(async (tx) => {
    await lockPostSaleCostCase(tx, input.caseId);
    const snapshot = await calculateProductPostSaleCostCaseWithExecutor(tx, input.caseId);
    const calculation = snapshot.calculation;
    if (calculation.kind === "exception") throw new Error(calculation.reason);
    const transfer = calculation.transfer;
    const [existing] = await tx.select().from(productPostSaleCostSettlement).where(eq(productPostSaleCostSettlement.caseId, input.caseId)).limit(1).for("update");
    if (existing) {
      if (existing.proofKey === input.proofKey) {
        if (existing.movementSnapshotHash && existing.movementSnapshotHash !== snapshot.movementSnapshotHash) {
          throw new Error("post_sale_cost_settlement_snapshot_mismatch");
        }
        return { status: "already_confirmed" as const, settlement: existing, calculation };
      }
      throw new Error("post_sale_cost_settlement_already_confirmed");
    }
    if (!transfer) {
      await tx.update(productPostSaleCostCase).set({ status: "settled", updatedAt: new Date() }).where(eq(productPostSaleCostCase.id, input.caseId));
      return { status: "no_transfer_required" as const, calculation };
    }
    const [settlement] = await tx.insert(productPostSaleCostSettlement).values({
      caseId: input.caseId,
      debtor: transfer.debtor,
      creditor: transfer.creditor,
      amountCentavos: transfer.amountCentavos,
      operatorUserId: input.operatorUserId ?? null,
      operatorEmail: input.operatorEmail.trim().toLowerCase(),
      proofUrl: input.proofUrl.trim(),
      proofKey: input.proofKey.trim(),
      movementSnapshotHash: snapshot.movementSnapshotHash,
      calculationSnapshot: snapshot.snapshot,
      confirmedAt: new Date(),
    }).returning();
    if (!settlement) throw new Error("post_sale_cost_settlement_not_persisted");
    await tx.update(productPostSaleCostCase).set({ status: "settled", updatedAt: new Date() }).where(eq(productPostSaleCostCase.id, input.caseId));
    return { status: "confirmed" as const, settlement, calculation, movementSnapshotHash: snapshot.movementSnapshotHash };
  });
}
