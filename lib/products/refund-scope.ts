const ORDER_BUMP_ORDER_IDS_KEY = "order_bump_order_ids";
const ORDER_BUMP_MARKER_KEY = "order_bump";
const ORDER_BUMP_PARENT_ORDER_ID_KEY = "order_bump_parent_order_id";
const MAX_ORDER_BUMPS = 5;

export type RefundOrderReference = {
  id: string;
  attribution: Record<string, string | null> | null;
};

export function parseRefundBumpOrderIds(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > MAX_ORDER_BUMPS) return [];
  return [...new Set(ids)];
}

export function getProductRefundRootOrderId(input: RefundOrderReference): string {
  if (input.attribution?.[ORDER_BUMP_MARKER_KEY] !== "true") return input.id;
  const parentOrderId = input.attribution[ORDER_BUMP_PARENT_ORDER_ID_KEY];
  if (!parentOrderId || parentOrderId === input.id) {
    throw new Error("invalid_product_checkout_group");
  }
  return parentOrderId;
}

export function getProductRefundBumpOrderIds(
  attribution: Record<string, string | null> | null | undefined,
): string[] {
  return parseRefundBumpOrderIds(attribution?.[ORDER_BUMP_ORDER_IDS_KEY]);
}

export function buildProductRefundCheckoutSummary(
  root: { id: string; productTitle: string; priceCentavos: number },
  bumps: Array<{ id: string; productTitle: string; priceCentavos: number }>,
) {
  const items = [root, ...bumps].map((item) => ({
    orderId: item.id,
    title: item.productTitle,
    amountCentavos: item.priceCentavos,
  }));
  return {
    orderIds: items.map((item) => item.orderId),
    items,
    totalCentavos: items.reduce((total, item) => total + item.amountCentavos, 0),
  };
}
