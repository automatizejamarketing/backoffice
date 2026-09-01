/**
 * Espelho leve do frontend (`automatize-frontend/lib/vindi/sandbox.ts`):
 * o sandbox da Vindi exige endereço completo para transações Pix; produção
 * não. Nunca enviar este endereço para a API live.
 */
export type VindiCustomerAddress = {
  street: string;
  number: string;
  zipcode: string;
  city: string;
  state: string;
  country: string;
  neighborhood: string;
};

export const VINDI_SANDBOX_PIX_FALLBACK_ADDRESS: VindiCustomerAddress = {
  street: "Rua Saldanha Marinho",
  number: "452",
  zipcode: "28010272",
  city: "Campos dos Goytacazes",
  state: "RJ",
  country: "BR",
  neighborhood: "Centro",
};

export function isVindiSandboxBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname.toLowerCase().startsWith("sandbox");
  } catch {
    return false;
  }
}

export function vindiPixAddressForEnv(
  env: { VINDI_API_BASE_URL?: string } = process.env as {
    VINDI_API_BASE_URL?: string;
  },
): VindiCustomerAddress | undefined {
  return isVindiSandboxBaseUrl(env.VINDI_API_BASE_URL)
    ? VINDI_SANDBOX_PIX_FALLBACK_ADDRESS
    : undefined;
}
