import {
  buildPartnersSettingsUrl,
  getAutomatizeBusinessIdFromEnv,
} from "@/lib/meta-business/partner-access-status";

export type ReconnectInfo = {
  url: string;
  instructions: string;
};

/**
 * Customer self-serve reconnect link. Prefer the audited consultant OAuth
 * (`/api/users/[id]/meta-account/admin-reconnect`) when a consultant can
 * operate the assets — never ask for the customer's Facebook password.
 */
export function buildReconnectInfo(): ReconnectInfo {
  const redirectUri =
    process.env.META_MARKETING_REDIRECT_URI ??
    process.env.NEXT_PUBLIC_META_MARKETING_REDIRECT_URI;
  let origin = "https://www.automatizemarketing.com";
  if (redirectUri) {
    try {
      origin = new URL(redirectUri).origin;
    } catch {
      // keep the fallback origin
    }
  }

  return {
    url: `${origin}/app/marketing`,
    instructions:
      "Se o cliente puder reconectar sozinho, envie este link. Ele precisa estar logado no Automatize. Preferível: use Reconectar como consultor no backoffice — nunca peça a senha do Facebook.",
  };
}

export function buildPartnerShareInfo(clientBusinessId: string | null): {
  businessId: string;
  partnersUrl: string | null;
  instructions: string;
} {
  const businessId = getAutomatizeBusinessIdFromEnv();
  return {
    businessId,
    partnersUrl: buildPartnersSettingsUrl(clientBusinessId),
    instructions: `Peça ao cliente para abrir Parceiros no Gerenciador de Negócios, colar o ID ${businessId} e conceder Página, Instagram e conta de anúncios. Não peça a senha do Facebook.`,
  };
}
