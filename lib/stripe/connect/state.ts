/** Campos espelhados da Conta Stripe do Expert em `expert_profiles`. */
export type ExpertStripeProfileMirror = {
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
};

export type ExpertStripeAccountState =
  | { status: "not_connected" }
  | { status: "connected_without_charges"; stripeAccountId: string }
  | { status: "enabled"; stripeAccountId: string };

/**
 * Deriva o estado da Conta Stripe do Expert a partir do espelho persistido.
 * Três estados: não conectada, conectada sem cobranças, habilitada.
 */
export function deriveExpertStripeAccountState(
  profile: ExpertStripeProfileMirror,
): ExpertStripeAccountState {
  if (!profile.stripeAccountId) {
    return { status: "not_connected" };
  }
  if (!profile.stripeChargesEnabled) {
    return {
      status: "connected_without_charges",
      stripeAccountId: profile.stripeAccountId,
    };
  }
  return {
    status: "enabled",
    stripeAccountId: profile.stripeAccountId,
  };
}
