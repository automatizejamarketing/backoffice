import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  payment,
  subscription,
  user,
  vindiPaymentLink,
} from "@/lib/db/schema";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";
import type { VindiBackofficeRecoveryStore } from "./recovery-charge";

export function createDbVindiRecoveryStore(): VindiBackofficeRecoveryStore {
  return {
    async getSnapshot(userId) {
      const [foundUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!foundUser) return null;

      const subscriptions = await db
        .select()
        .from(subscription)
        .where(eq(subscription.userId, userId));
      const active = pickActiveSubscription(subscriptions);
      if (!active) {
        return {
          userId,
          subscription: null,
          failedPayment: null,
          pendingRecoveryLink: null,
        };
      }

      const [failedPayment] = await db
        .select({
          vindiChargeId: payment.vindiChargeId,
          vindiBillId: payment.vindiBillId,
          amount: payment.amount,
          currency: payment.currency,
          failureReason: payment.failureReason,
          createdAt: payment.createdAt,
        })
        .from(payment)
        .where(
          and(
            eq(payment.userId, userId),
            eq(payment.subscriptionId, active.id),
            eq(payment.provider, "vindi"),
            eq(payment.status, "failed"),
          ),
        )
        .orderBy(desc(payment.createdAt))
        .limit(1);

      const [pendingRecoveryLink] = await db
        .select({
          id: vindiPaymentLink.id,
          emvPayload: vindiPaymentLink.emvPayload,
          vindiBillId: vindiPaymentLink.vindiBillId,
          vindiChargeId: vindiPaymentLink.vindiChargeId,
          amount: vindiPaymentLink.amount,
          expiresAt: vindiPaymentLink.expiresAt,
        })
        .from(vindiPaymentLink)
        .where(
          and(
            eq(vindiPaymentLink.userId, userId),
            eq(vindiPaymentLink.source, "subscription_recovery"),
            eq(vindiPaymentLink.status, "pending"),
            gt(vindiPaymentLink.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(vindiPaymentLink.createdAt))
        .limit(1);

      return {
        userId,
        subscription: {
          id: active.id,
          provider: active.provider,
          status: active.status,
          planType: active.planType,
          vindiPaymentMethod: active.vindiPaymentMethod ?? null,
        },
        failedPayment: failedPayment ?? null,
        pendingRecoveryLink:
          pendingRecoveryLink?.emvPayload
            ? {
                id: pendingRecoveryLink.id,
                emvPayload: pendingRecoveryLink.emvPayload,
                vindiBillId: pendingRecoveryLink.vindiBillId,
                vindiChargeId: pendingRecoveryLink.vindiChargeId,
                amount: pendingRecoveryLink.amount,
                expiresAt: pendingRecoveryLink.expiresAt,
              }
            : null,
      };
    },
    async persistRecoveryLink(input) {
      const [existing] = await db
        .select({ id: vindiPaymentLink.id })
        .from(vindiPaymentLink)
        .where(eq(vindiPaymentLink.vindiBillId, input.vindiBillId))
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(vindiPaymentLink)
          .set({
            emvPayload: input.emvPayload,
            vindiChargeId: input.vindiChargeId,
            amount: input.amount,
            status: "pending",
            source: "subscription_recovery",
            expiresAt: input.expiresAt,
            paidAt: null,
            updatedAt: input.now,
          })
          .where(eq(vindiPaymentLink.id, existing.id))
          .returning();
        if (!updated?.emvPayload) {
          throw new Error("Falha ao atualizar o Pix de recuperação Vindi.");
        }
        return {
          id: updated.id,
          emvPayload: updated.emvPayload,
          vindiBillId: updated.vindiBillId,
          vindiChargeId: updated.vindiChargeId,
          amount: updated.amount,
          expiresAt: updated.expiresAt,
        };
      }

      const [created] = await db
        .insert(vindiPaymentLink)
        .values({
          userId: input.userId,
          purpose: "subscription",
          planType: input.planType,
          amount: input.amount,
          currency: "brl",
          emvPayload: input.emvPayload,
          vindiBillId: input.vindiBillId,
          vindiChargeId: input.vindiChargeId,
          status: "pending",
          source: "subscription_recovery",
          expiresAt: input.expiresAt,
        })
        .returning();
      if (!created?.emvPayload) {
        throw new Error("Falha ao salvar o Pix de recuperação Vindi.");
      }
      return {
        id: created.id,
        emvPayload: created.emvPayload,
        vindiBillId: created.vindiBillId,
        vindiChargeId: created.vindiChargeId,
        amount: created.amount,
        expiresAt: created.expiresAt,
      };
    },
    async writeAudit(entry) {
      await db.insert(backofficeAuditLog).values(entry);
    },
  };
}
