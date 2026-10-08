import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mercadopagoPaymentLink, subscription, user } from "@/lib/db/schema";
import {
  buildAccessSummary,
  type AccessSummary,
} from "@/lib/subscriptions/access-summary";

/**
 * Access + billing summary for one client, or null when the user does not
 * exist. Reads only the columns the summary needs: callers with marketing
 * access (consultants) get display strings, never Stripe IDs or payments.
 */
export async function getUserAccessSummary(
  userId: string,
): Promise<AccessSummary | null> {
  const [found] = await db
    .select({ expirationDate: user.expirationDate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!found) return null;

  const [subscriptions, pixLinks] = await Promise.all([
    db
      .select({
        provider: subscription.provider,
        status: subscription.status,
        planType: subscription.planType,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodEnd: subscription.currentPeriodEnd,
        createdAt: subscription.createdAt,
      })
      .from(subscription)
      .where(eq(subscription.userId, userId)),
    db
      .select({
        status: mercadopagoPaymentLink.status,
        planType: mercadopagoPaymentLink.planType,
        amount: mercadopagoPaymentLink.amount,
        createdAt: mercadopagoPaymentLink.createdAt,
        expiresAt: mercadopagoPaymentLink.expiresAt,
      })
      .from(mercadopagoPaymentLink)
      .where(eq(mercadopagoPaymentLink.userId, userId))
      .orderBy(desc(mercadopagoPaymentLink.createdAt))
      .limit(1),
  ]);

  return buildAccessSummary({
    expirationDate: found.expirationDate,
    subscriptions,
    pixLinks,
  });
}
