import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createExpertStripeOnboardingLinkForAdmin,
  refreshExpertStripeAccountForAdmin,
} from "./expert-account-admin";
import type { StripeConnectAccountView, StripeConnectClient } from "./port";
import type {
  ExpertStripeAccountRecord,
  ExpertStripeAccountRepository,
} from "./repository";

const EXPERT_ID = "expert_profile_1";
const EXPERT_EMAIL = "expert@example.com";
const STRIPE_ACCOUNT_ID = "acct_expert_1";

function createMemoryRepository(
  initial: ExpertStripeAccountRecord,
): ExpertStripeAccountRepository & { read(): ExpertStripeAccountRecord } {
  let record = { ...initial };
  return {
    read: () => ({ ...record }),
    findByExpertId: async (expertId) =>
      expertId === record.expertId ? { ...record } : null,
    setStripeAccountId: async (expertId, stripeAccountId) => {
      if (expertId !== record.expertId) throw new Error("expert not found");
      record = { ...record, stripeAccountId };
    },
    updateMirror: async (expertId, mirror) => {
      if (expertId !== record.expertId) throw new Error("expert not found");
      record = { ...record, ...mirror };
    },
  };
}

function baseRecord(
  overrides: Partial<ExpertStripeAccountRecord> = {},
): ExpertStripeAccountRecord {
  return {
    expertId: EXPERT_ID,
    email: EXPERT_EMAIL,
    stripeAccountId: STRIPE_ACCOUNT_ID,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
    stripeAccountUpdatedAt: null,
    ...overrides,
  };
}

function createFakeClient(account: StripeConnectAccountView) {
  const retrieved: string[] = [];
  const accountLinks: Array<{ account: string; return_url: string }> = [];

  const client: Pick<StripeConnectClient, "accounts" | "accountLinks"> = {
    accounts: {
      retrieve: async (accountId) => {
        retrieved.push(accountId);
        return account;
      },
    },
    accountLinks: {
      create: async (params) => {
        accountLinks.push({
          account: params.account,
          return_url: params.return_url,
        });
        return { url: "https://connect.stripe.com/onboarding/test-link" };
      },
    },
  };

  return { client, retrieved, accountLinks };
}

describe("Conta Stripe do Expert no backoffice (cliente Connect falso)", () => {
  it("Atualizar estado relê a conta e persiste charges_enabled", async () => {
    const repository = createMemoryRepository(baseRecord());
    const syncedAt = new Date("2026-09-04T12:00:00.000Z");
    const { client, retrieved } = createFakeClient({
      id: STRIPE_ACCOUNT_ID,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    const updated = await refreshExpertStripeAccountForAdmin({
      repository,
      client,
      expertId: EXPERT_ID,
      syncedAt,
    });

    assert.deepEqual(retrieved, [STRIPE_ACCOUNT_ID]);
    assert.equal(updated.stripeChargesEnabled, true);
    assert.equal(updated.stripePayoutsEnabled, true);
    assert.equal(updated.stripeDetailsSubmitted, true);
    assert.equal(
      repository.read().stripeAccountUpdatedAt?.toISOString(),
      syncedAt.toISOString(),
    );
  });

  it("Reenviar onboarding gera Account Link novo do tipo account_onboarding", async () => {
    const repository = createMemoryRepository(baseRecord());
    const { client, accountLinks } = createFakeClient({
      id: STRIPE_ACCOUNT_ID,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });

    const result = await createExpertStripeOnboardingLinkForAdmin({
      repository,
      client,
      expertId: EXPERT_ID,
      frontendAppUrl: "https://staging.automatizemarketing.com",
    });

    assert.equal(
      result.onboardingUrl,
      "https://connect.stripe.com/onboarding/test-link",
    );
    assert.deepEqual(accountLinks, [
      {
        account: STRIPE_ACCOUNT_ID,
        return_url:
          "https://staging.automatizemarketing.com/api/expert/stripe-account/return",
      },
    ]);
  });

  it("Reenviar onboarding falha quando Expert ainda não tem conta", async () => {
    const repository = createMemoryRepository(
      baseRecord({ stripeAccountId: null }),
    );
    const { client } = createFakeClient({
      id: STRIPE_ACCOUNT_ID,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });

    await assert.rejects(
      () =>
        createExpertStripeOnboardingLinkForAdmin({
          repository,
          client,
          expertId: EXPERT_ID,
          frontendAppUrl: "https://staging.automatizemarketing.com",
        }),
      /Conta Stripe do Expert/,
    );
  });
});
