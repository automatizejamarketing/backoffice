import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  payment,
  subscription,
  user,
  vindiPaymentLink,
} from "@/lib/db/schema";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";
import type { VindiPaidOutOfBandStore } from "./paid-out-of-band";

export function createDbVindiPaidOutOfBandStore(): VindiPaidOutOfBandStore {
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

      const [subscriptions, openLinks, failedPayments] = await Promise.all([
        db.select().from(subscription).where(eq(subscription.userId, userId)),
        db
          .select()
          .from(vindiPaymentLink)
          .where(
            and(
              eq(vindiPaymentLink.userId, userId),
              eq(vindiPaymentLink.purpose, "subscription"),
              eq(vindiPaymentLink.status, "pending"),
            ),
          )
          .orderBy(desc(vindiPaymentLink.createdAt)),
        db
          .select({
            vindiBillId: payment.vindiBillId,
            subscriptionId: payment.subscriptionId,
          })
          .from(payment)
          .where(
            and(
              eq(payment.userId, userId),
              eq(payment.provider, "vindi"),
              eq(payment.status, "failed"),
            ),
          )
          .orderBy(desc(payment.createdAt))
          .limit(5),
      ]);

      const active = pickActiveSubscription(subscriptions);
      const failedPaymentBillId =
        failedPayments.find(
          (row) =>
            row.vindiBillId &&
            (!active || row.subscriptionId === active.id),
        )?.vindiBillId ??
        failedPayments.find((row) => row.vindiBillId)?.vindiBillId ??
        null;

      return {
        userId: foundUser.id,
        expirationDate: foundUser.expirationDate,
        planType: active?.planType ?? null,
        subscriptionId: active?.id ?? null,
        subscriptionStatus: active?.status ?? null,
        openLinks: openLinks.map((link) => ({
          id: link.id,
          vindiBillId: link.vindiBillId,
          planType: link.planType,
          status: link.status,
        })),
        failedPaymentBillId,
      };
    },
    async setExpiration(userId, expiration) {
      await db
        .update(user)
        .set({ expirationDate: expiration })
        .where(eq(user.id, userId));
    },
    async markLinksCanceled(ids, now) {
      if (ids.length === 0) return;
      await db
        .update(vindiPaymentLink)
        .set({ status: "canceled", updatedAt: now })
        .where(inArray(vindiPaymentLink.id, ids));
    },
    async writeAudit(entry) {
      await db.insert(backofficeAuditLog).values(entry);
    },
  };
}
