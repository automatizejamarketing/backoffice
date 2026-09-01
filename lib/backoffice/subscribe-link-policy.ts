import type { BillingProvider, SubscriptionStatus } from "@/lib/db/schema";

/**
 * Política do link público de assinatura (`/pagar/<token>` no frontend).
 *
 * O link serve para quem está SEM acesso — cadastro que nunca assinou ou
 * assinante expirado. As regras aqui espelham o que o frontend impõe na
 * página e nas APIs do link, para que o Backoffice nem ofereça um link que
 * seria bloqueado do outro lado:
 *
 * - `expiration_date` futura = plano ativo → bloqueado.
 * - Assinatura Stripe ou Vindi viva (mesmo com acesso expirado, ex.
 *   `past_due`) → bloqueado; renovação/recuperação são as ferramentas certas.
 *   `provider` nulo é tratado como Stripe (fail-closed, como na política de
 *   Pix). Assinatura Mercado Pago/manual não bloqueia: é pré-pago e o
 *   checkout converte.
 */

export const SUBSCRIBE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
];

type SubscriptionLike = {
  provider?: BillingProvider | string | null;
  status?: SubscriptionStatus | string | null;
};

function blocksSubscribeLink(subscription: SubscriptionLike): boolean {
  const provider = subscription.provider ?? "stripe";
  if (provider !== "stripe" && provider !== "vindi") return false;
  return LIVE_SUBSCRIPTION_STATUSES.includes(
    subscription.status as SubscriptionStatus,
  );
}

export function getSubscribeLinkDisabledReason(input: {
  expirationDate: Date | string | null;
  subscriptions: SubscriptionLike[];
  now?: Date;
}): string | null {
  const now = input.now ?? new Date();
  const expirationDate =
    typeof input.expirationDate === "string"
      ? new Date(input.expirationDate)
      : input.expirationDate;
  if (expirationDate && expirationDate > now) {
    return "Este usuário já tem plano ativo — o link seria bloqueado.";
  }
  if (input.subscriptions.some(blocksSubscribeLink)) {
    return "Este usuário tem assinatura Stripe ou Vindi ativa — use a renovação ou a recuperação.";
  }
  return null;
}

export function buildSubscribeLinkUrl(
  token: string,
  frontendOrigin: string,
): string {
  return new URL(`/pagar/${token}`, frontendOrigin.trim()).toString();
}
