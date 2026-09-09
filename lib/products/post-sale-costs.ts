import { and, eq, inArray } from "drizzle-orm";
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

async function checkoutOrders(order: ProductOrder) {
  const parentId = order.attribution?.[ORDER_BUMP_PARENT_ORDER_ID_KEY];
  const root = parentId
    ? (await db.select().from(productOrder).where(eq(productOrder.id, parentId)).limit(1))[0]
    : order;
  if (!root) throw new Error("post_sale_cost_root_order_not_found");
  const bumpIds = parseOrderBumpOrderIds(root.attribution?.[ORDER_BUMP_ORDER_IDS_ATTRIBUTION_KEY]);
  const bumps = bumpIds.length
    ? await db.select().from(productOrder).where(inArray(productOrder.id, bumpIds))
    : [];
  const byId = new Map(bumps.map((item) => [item.id, item]));
  const ordered = bumpIds.map((id) => byId.get(id));
  if (ordered.some((item) => !item || item.buyerEmail !== root.buyerEmail || item.currency !== root.currency)) {
    throw new Error("post_sale_cost_checkout_group_invalid");
  }
  return [root, ...(ordered as ProductOrder[])];
}

export async function calculateProductPostSaleCostCase(caseId: string) {
  const [row] = await db
    .select({ case: productPostSaleCostCase, payment: productPayment, order: productOrder })
    .from(productPostSaleCostCase)
    .innerJoin(productPayment, eq(productPayment.id, productPostSaleCostCase.paymentId))
    .innerJoin(productOrder, eq(productOrder.id, productPayment.orderId))
    .where(eq(productPostSaleCostCase.id, caseId))
    .limit(1);
  if (!row) throw new Error("post_sale_cost_case_not_found");
  const orders = await checkoutOrders(row.order);
  const movements = await db.select().from(productPostSaleCostMovement).where(eq(productPostSaleCostMovement.caseId, caseId));
  const calculation = apportionPostSaleCosts({
    reversal: row.case.reversal,
    items: orders.map((order) => ({ orderId: order.id, commercialPriceCentavos: order.priceCentavos, expertShareBasisPoints: order.ownerExpertShareBasisPoints })),
    movements: movements.map((movement) => ({
      id: movement.providerMovementId,
      kind: movement.kind,
      attribution: movement.attribution,
      orderId: movement.orderId ?? undefined,
      amountCentavos: movement.amountCentavos,
      supportedBy: movement.supportedBy,
    })),
  });
  const [settlement] = await db.select().from(productPostSaleCostSettlement).where(eq(productPostSaleCostSettlement.caseId, caseId)).limit(1);
  return { ...row, orders, movements, calculation, settlement: settlement ?? null };
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
  const snapshot = await calculateProductPostSaleCostCase(input.caseId);
  const calculation = snapshot.calculation;
  if (calculation.kind === "exception") throw new Error(calculation.reason);
  const transfer = calculation.transfer;
  if (!transfer) return { status: "no_transfer_required" as const, calculation };
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(productPostSaleCostSettlement).where(eq(productPostSaleCostSettlement.caseId, input.caseId)).limit(1).for("update");
    if (existing) {
      if (existing.proofKey === input.proofKey) return { status: "already_confirmed" as const, settlement: existing, calculation: snapshot.calculation };
      throw new Error("post_sale_cost_settlement_already_confirmed");
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
      confirmedAt: new Date(),
    }).returning();
    if (!settlement) throw new Error("post_sale_cost_settlement_not_persisted");
    await tx.update(productPostSaleCostCase).set({ status: "settled", updatedAt: new Date() }).where(eq(productPostSaleCostCase.id, input.caseId));
    return { status: "confirmed" as const, settlement, calculation };
  });
}
