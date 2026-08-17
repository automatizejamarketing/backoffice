import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  pendingPlanChange,
  subscription,
  subscriptionEvent,
  user,
  vindiPaymentLink,
} from "@/lib/db/schema";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";
import type { VindiBackofficeCancelStore } from "./subscription-cancel-charge";

export function createDbVindiCancelStore(): VindiBackofficeCancelStore {
  return {
    async getSnapshot(userId) {
      const [foundUser] = await db
        .select({
          id: user.id,
          expirationDate: user.expirationDate,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!foundUser) return null;

      const [subscriptions, openLinks] = await Promise.all([
        db.select().from(subscription).where(eq(subscription.userId, userId)),
        db
          .select({
            id: vindiPaymentLink.id,
            vindiBillId: vindiPaymentLink.vindiBillId,
            status: vindiPaymentLink.status,
          })
          .from(vindiPaymentLink)
          .where(
            and(
              eq(vindiPaymentLink.userId, userId),
              eq(vindiPaymentLink.purpose, "subscription"),
              eq(vindiPaymentLink.status, "pending"),
            ),
          ),
      ]);

      const active = pickActiveSubscription(subscriptions);
      return {
        userId: foundUser.id,
        expirationDate: foundUser.expirationDate,
        subscription: active
          ? {
              id: active.id,
              provider: active.provider,
              status: active.status,
              planType: active.planType,
              vindiPaymentMethod: active.vindiPaymentMethod ?? null,
              vindiSubscriptionId: active.vindiSubscriptionId ?? null,
              cancelAtPeriodEnd: active.cancelAtPeriodEnd,
              currentPeriodEnd: active.currentPeriodEnd,
              currentPeriodStart: active.currentPeriodStart,
              vindiConsentAuthorizedAt: active.vindiConsentAuthorizedAt,
            }
          : null,
        openLinks,
      };
    },
    async applyPaidCancel(input) {
      await db
        .update(subscription)
        .set({
          status: input.effects.status,
          cancelAtPeriodEnd: input.effects.cancelAtPeriodEnd,
          canceledAt: input.effects.canceledAt,
          endedAt: input.effects.endedAt,
          updatedAt: input.now,
        })
        .where(eq(subscription.id, input.subscriptionId));
    },
    async applyTrialCancel(input) {
      await db.transaction(async (tx) => {
        await tx
          .update(subscription)
          .set({
            status: "canceled",
            cancelAtPeriodEnd: false,
            canceledAt: input.now,
            endedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(subscription.id, input.subscriptionId));
        await tx
          .update(user)
          .set({ expirationDate: input.now })
          .where(eq(user.id, input.userId));
      });
    },
    async cancelPendingPlanChanges(userId, now) {
      await db
        .update(pendingPlanChange)
        .set({ status: "canceled", updatedAt: now })
        .where(
          and(
            eq(pendingPlanChange.userId, userId),
            eq(pendingPlanChange.status, "pending"),
          ),
        );
    },
    async markLinksSuperseded(ids, now) {
      if (ids.length === 0) return;
      await db
        .update(vindiPaymentLink)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(vindiPaymentLink.status, "pending"),
            inArray(vindiPaymentLink.id, ids),
          ),
        );
    },
    async writeEvent(entry) {
      await db.insert(subscriptionEvent).values(entry);
    },
    async writeAudit(entry) {
      await db.insert(backofficeAuditLog).values(entry);
    },
  };
}
