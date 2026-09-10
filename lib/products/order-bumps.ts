import { z } from "zod";

export const ORDER_BUMP_ORDER_IDS_ATTRIBUTION_KEY = "order_bump_order_ids" as const;
export const ORDER_BUMP_PARENT_ORDER_ID_KEY = "order_bump_parent_order_id" as const;
const MAX_ORDER_BUMPS = 5;

/**
 * The backoffice only needs the immutable checkout grouping metadata to read
 * post-sale cases. Keep this parser strict and side-effect free.
 */
export function parseOrderBumpOrderIds(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const parsed = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (parsed.length > MAX_ORDER_BUMPS) return [];
  const result = z.array(z.string().uuid()).safeParse(parsed);
  return result.success ? [...new Set(result.data)] : [];
}
