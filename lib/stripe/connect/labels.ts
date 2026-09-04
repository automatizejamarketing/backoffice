import type { ExpertStripeAccountState } from "./state";

export const expertStripeAccountStateLabel: Record<
  ExpertStripeAccountState["status"],
  string
> = {
  not_connected: "Não conectada",
  connected_without_charges: "Conectada sem cobranças",
  enabled: "Habilitada",
};

export const expertCardUnavailableMessage =
  "Cartão indisponível: Expert sem Conta Stripe habilitada.";
