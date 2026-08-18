import { z } from "zod";

export const PRODUCT_FUNNEL_EVENT_TYPE_VALUES = [
  "product_click",
  "checkout_started",
] as const;
export type ProductFunnelEventType =
  (typeof PRODUCT_FUNNEL_EVENT_TYPE_VALUES)[number];

export const PRODUCT_FUNNEL_SOURCE_VALUES = [
  "public_catalog",
  "app_catalog",
  "public_checkout",
  "app_checkout",
] as const;
export type ProductFunnelSource =
  (typeof PRODUCT_FUNNEL_SOURCE_VALUES)[number];

export const PRODUCT_CLICK_SOURCE_VALUES = [
  "public_catalog",
  "app_catalog",
] as const;
export type ProductClickSource = (typeof PRODUCT_CLICK_SOURCE_VALUES)[number];

const productClickSchema = z.object({
  productId: z.string().uuid(),
  source: z.enum(PRODUCT_CLICK_SOURCE_VALUES),
});

export function parseProductClickInput(input: unknown): {
  productId: string;
  source: ProductClickSource;
} {
  return productClickSchema.parse(input);
}
