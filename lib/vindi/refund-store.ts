import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { backofficeAuditLog, payment } from "@/lib/db/schema";
import type { VindiRefundStore } from "./refund";

export function createDbVindiRefundStore(): VindiRefundStore {
  return {
    async getPayment(paymentId) {
      const [row] = await db
        .select({
          id: payment.id,
          userId: payment.userId,
          provider: payment.provider,
          status: payment.status,
          purpose: payment.purpose,
          vindiChargeId: payment.vindiChargeId,
          amount: payment.amount,
          currency: payment.currency,
        })
        .from(payment)
        .where(eq(payment.id, paymentId))
        .limit(1);
      return row ?? null;
    },
    async markRefunded({ paymentId, refundedAmount, now }) {
      await db
        .update(payment)
        .set({
          status: "refunded",
          refundedAmount,
          refundedAt: now,
          reversalKind: "refund",
        })
        .where(eq(payment.id, paymentId));
    },
    async writeAudit(entry) {
      await db.insert(backofficeAuditLog).values(entry);
    },
  };
}
