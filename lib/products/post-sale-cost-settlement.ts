export type PostSaleParty = "expert" | "automatize";

export type PostSaleCostMovement = {
  id: string;
  kind: "cost" | "credit";
  attribution: "common" | "specific";
  orderId?: string;
  amountCentavos: number;
  supportedBy: PostSaleParty;
};

type PostSaleCostItem = {
  orderId: string;
  commercialPriceCentavos: number;
  expertShareBasisPoints: number;
};

type SettlementItem = {
  orderId: string;
  remainingCostCentavos: number;
  expertResponsibilityCentavos: number;
  automatizeResponsibilityCentavos: number;
  expertSupportedCentavos: number;
  automatizeSupportedCentavos: number;
};

type Transfer = {
  debtor: PostSaleParty;
  creditor: PostSaleParty;
  amountCentavos: number;
};

export function apportionPostSaleCosts(input: {
  reversal: "integral_refund" | "lost_full_chargeback" | "external_partial" | "pix_med";
  items: readonly PostSaleCostItem[];
  movements: readonly PostSaleCostMovement[];
}):
  | { kind: "ready"; items: SettlementItem[]; transfer: Transfer | null }
  | { kind: "exception"; reason: "reversal_not_approved_for_settlement" } {
  if (input.reversal !== "integral_refund" && input.reversal !== "lost_full_chargeback") {
    return { kind: "exception", reason: "reversal_not_approved_for_settlement" };
  }

  const items = [...input.items].sort((left, right) => left.orderId.localeCompare(right.orderId));
  assertItems(items);
  const costByOrder = new Map(items.map((item) => [item.orderId, 0]));
  const supportedByOrder = new Map(items.map((item) => [item.orderId, { expert: 0, automatize: 0 }]));

  for (const movement of input.movements) {
    assertMovement(movement);
    const signedAmount = movement.kind === "cost" ? movement.amountCentavos : -movement.amountCentavos;
    const allocations = movement.attribution === "common"
      ? allocateCommonAmount(signedAmount, items)
      : allocateSpecificAmount(signedAmount, movement.orderId, items);
    for (const [orderId, amount] of allocations) {
      costByOrder.set(orderId, (costByOrder.get(orderId) ?? 0) + amount);
      const supported = supportedByOrder.get(orderId);
      if (!supported) throw new Error("post_sale_cost_unknown_order");
      supported[movement.supportedBy] += amount;
    }
  }

  const settlementItems = items.map((item) => {
    const remainingCostCentavos = Math.max(0, costByOrder.get(item.orderId) ?? 0);
    const expertResponsibilityCentavos = roundExpertCost(remainingCostCentavos, item.expertShareBasisPoints);
    const supported = supportedByOrder.get(item.orderId)!;
    return {
      orderId: item.orderId,
      remainingCostCentavos,
      expertResponsibilityCentavos,
      automatizeResponsibilityCentavos: remainingCostCentavos - expertResponsibilityCentavos,
      expertSupportedCentavos: supported.expert,
      automatizeSupportedCentavos: supported.automatize,
    };
  });
  const expertDifference = settlementItems.reduce(
    (sum, item) => sum + item.expertResponsibilityCentavos - item.expertSupportedCentavos,
    0,
  );

  return {
    kind: "ready",
    items: settlementItems,
    transfer: expertDifference === 0
      ? null
      : expertDifference > 0
        ? { debtor: "expert", creditor: "automatize", amountCentavos: expertDifference }
        : { debtor: "automatize", creditor: "expert", amountCentavos: -expertDifference },
  };
}

function allocateSpecificAmount(amount: number, orderId: string | undefined, items: readonly PostSaleCostItem[]) {
  if (!orderId || !items.some((item) => item.orderId === orderId)) {
    throw new Error("post_sale_cost_specific_attribution_requires_item");
  }
  return new Map([[orderId, amount]]);
}

/** Largest remainders, with the immutable order id as the fixed tie-breaker. */
function allocateCommonAmount(amount: number, items: readonly PostSaleCostItem[]) {
  const totalPrice = items.reduce((sum, item) => sum + item.commercialPriceCentavos, 0);
  if (totalPrice === 0) throw new Error("post_sale_cost_common_attribution_requires_commercial_price");
  const direction = Math.sign(amount);
  const absoluteAmount = Math.abs(amount);
  const shares = items.map((item) => {
    const numerator = absoluteAmount * item.commercialPriceCentavos;
    return { orderId: item.orderId, floor: Math.floor(numerator / totalPrice), remainder: numerator % totalPrice };
  });
  let remaining = absoluteAmount - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((left, right) => right.remainder - left.remainder || left.orderId.localeCompare(right.orderId));
  return new Map(shares.map((share) => [share.orderId, direction * (share.floor + (remaining-- > 0 ? 1 : 0))]));
}

/** Nearest cent; an exact half-cent is rounded down for the Expert (R17). */
function roundExpertCost(amountCentavos: number, expertShareBasisPoints: number) {
  return Math.floor((amountCentavos * expertShareBasisPoints + 4_999) / 10_000);
}

function assertItems(items: readonly PostSaleCostItem[]) {
  if (items.length === 0 || new Set(items.map((item) => item.orderId)).size !== items.length) {
    throw new Error("post_sale_cost_items_invalid");
  }
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.commercialPriceCentavos) ||
      item.commercialPriceCentavos < 0 ||
      !Number.isSafeInteger(item.expertShareBasisPoints) ||
      item.expertShareBasisPoints < 0 ||
      item.expertShareBasisPoints > 10_000
    ) {
      throw new Error("post_sale_cost_item_invalid");
    }
  }
}

function assertMovement(movement: PostSaleCostMovement) {
  if (!movement.id || !Number.isSafeInteger(movement.amountCentavos) || movement.amountCentavos < 0) {
    throw new Error("post_sale_cost_movement_invalid");
  }
}
