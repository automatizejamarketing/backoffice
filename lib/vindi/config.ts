import "server-only";

export function isVindiProductsEnabled(): boolean {
  return process.env.VINDI_PRODUCTS_ENABLED === "true";
}
