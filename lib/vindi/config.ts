import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function isVindiProductsEnabled(): boolean {
  return process.env.VINDI_PRODUCTS_ENABLED === "true";
}

export function isVindiSubscriptionsEnabled(): boolean {
  return process.env.VINDI_SUBSCRIPTIONS_ENABLED === "true";
}

export function getVindiPixMethodCode(): string {
  return requireEnv("VINDI_PIX_METHOD_CODE");
}
