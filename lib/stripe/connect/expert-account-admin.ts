import type { StripeConnectAccountView } from "./port";
import type {
  ExpertStripeAccountMirrorUpdate,
  ExpertStripeAccountRecord,
  ExpertStripeAccountRepository,
} from "./repository";
import { deriveExpertStripeAccountState } from "./state";

export function mirrorFromStripeAccount(
  account: StripeConnectAccountView,
  syncedAt: Date,
): ExpertStripeAccountMirrorUpdate {
  return {
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
    stripeDetailsSubmitted: account.details_submitted,
    stripeAccountUpdatedAt: syncedAt,
  };
}

export async function refreshExpertStripeAccountForAdmin(params: {
  repository: ExpertStripeAccountRepository;
  client: Pick<import("./port").StripeConnectClient, "accounts">;
  expertId: string;
  syncedAt?: Date;
}): Promise<ExpertStripeAccountRecord> {
  const expert = await params.repository.findByExpertId(params.expertId);
  if (!expert) {
    throw new Error("Expert não encontrado");
  }
  if (!expert.stripeAccountId) {
    throw new Error("Expert ainda não possui Conta Stripe do Expert");
  }

  const account = await params.client.accounts.retrieve(expert.stripeAccountId);
  const syncedAt = params.syncedAt ?? new Date();
  await params.repository.updateMirror(
    params.expertId,
    mirrorFromStripeAccount(account, syncedAt),
  );

  return {
    ...expert,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
    stripeDetailsSubmitted: account.details_submitted,
    stripeAccountUpdatedAt: syncedAt,
  };
}

export async function createExpertStripeOnboardingLinkForAdmin(params: {
  repository: ExpertStripeAccountRepository;
  client: Pick<
    import("./port").StripeConnectClient,
    "accounts" | "accountLinks"
  >;
  expertId: string;
  frontendAppUrl: string;
}): Promise<{ onboardingUrl: string }> {
  const expert = await params.repository.findByExpertId(params.expertId);
  if (!expert) {
    throw new Error("Expert não encontrado");
  }
  if (!expert.stripeAccountId) {
    throw new Error(
      "Expert ainda não iniciou a Conta Stripe do Expert — peça que conecte pelo Painel do Expert",
    );
  }

  const baseUrl = params.frontendAppUrl.replace(/\/$/, "");
  const returnUrl = `${baseUrl}/api/expert/stripe-account/return`;
  const refreshUrl = `${returnUrl}?refresh=1`;
  const link = await params.client.accountLinks.create({
    account: expert.stripeAccountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });

  return { onboardingUrl: link.url };
}

export function describeExpertStripeAccount(record: ExpertStripeAccountRecord) {
  return {
    state: deriveExpertStripeAccountState({
      stripeAccountId: record.stripeAccountId,
      stripeChargesEnabled: record.stripeChargesEnabled,
    }),
    stripeAccountUpdatedAt:
      record.stripeAccountUpdatedAt?.toISOString() ?? null,
  };
}
