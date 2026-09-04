import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { expertProfile, user } from "@/lib/db/schema";

export type ExpertStripeAccountRecord = {
  expertId: string;
  email: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAccountUpdatedAt: Date | null;
};

export type ExpertStripeAccountMirrorUpdate = {
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAccountUpdatedAt: Date;
};

export type ExpertStripeAccountRepository = {
  findByExpertId(expertId: string): Promise<ExpertStripeAccountRecord | null>;
  setStripeAccountId(
    expertId: string,
    stripeAccountId: string,
  ): Promise<void>;
  updateMirror(
    expertId: string,
    mirror: ExpertStripeAccountMirrorUpdate,
  ): Promise<void>;
};

function mapRow(row: {
  id: string;
  email: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAccountUpdatedAt: Date | null;
}): ExpertStripeAccountRecord {
  return {
    expertId: row.id,
    email: row.email,
    stripeAccountId: row.stripeAccountId,
    stripeChargesEnabled: row.stripeChargesEnabled,
    stripePayoutsEnabled: row.stripePayoutsEnabled,
    stripeDetailsSubmitted: row.stripeDetailsSubmitted,
    stripeAccountUpdatedAt: row.stripeAccountUpdatedAt,
  };
}

export function createExpertStripeAccountRepository(): ExpertStripeAccountRepository {
  return {
    findByExpertId: async (expertId) => {
      const [row] = await db
        .select({
          id: expertProfile.id,
          email: user.email,
          stripeAccountId: expertProfile.stripeAccountId,
          stripeChargesEnabled: expertProfile.stripeChargesEnabled,
          stripePayoutsEnabled: expertProfile.stripePayoutsEnabled,
          stripeDetailsSubmitted: expertProfile.stripeDetailsSubmitted,
          stripeAccountUpdatedAt: expertProfile.stripeAccountUpdatedAt,
        })
        .from(expertProfile)
        .innerJoin(user, eq(expertProfile.userId, user.id))
        .where(eq(expertProfile.id, expertId))
        .limit(1);
      return row ? mapRow(row) : null;
    },
    setStripeAccountId: async (expertId, stripeAccountId) => {
      await db
        .update(expertProfile)
        .set({ stripeAccountId, updatedAt: new Date() })
        .where(eq(expertProfile.id, expertId));
    },
    updateMirror: async (expertId, mirror) => {
      await db
        .update(expertProfile)
        .set({
          stripeChargesEnabled: mirror.stripeChargesEnabled,
          stripePayoutsEnabled: mirror.stripePayoutsEnabled,
          stripeDetailsSubmitted: mirror.stripeDetailsSubmitted,
          stripeAccountUpdatedAt: mirror.stripeAccountUpdatedAt,
          updatedAt: new Date(),
        })
        .where(eq(expertProfile.id, expertId));
    },
  };
}
