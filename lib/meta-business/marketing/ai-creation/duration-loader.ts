import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { subscription, user } from "@/lib/db/schema";
import {
  campaignDurationDays,
  type AiCampaignDurationPolicy,
} from "../../ai-campaign-duration";

/**
 * Inject the application's select executor (or Mat's agentDb). This reader must
 * also load outside Next.js, so it never imports a concrete DB or server-only.
 * The customer ID is the authorized target, including in the backoffice.
 */
export async function loadAiCampaignDuration(
  customerId: string,
  db: Pick<PostgresJsDatabase, "select">,
  options?: { now?: Date; bypassStripe?: boolean },
): Promise<AiCampaignDurationPolicy> {
  const [users, subscriptions] = await Promise.all([
    db.select({ expirationDate: user.expirationDate })
      .from(user)
      .where(eq(user.id, customerId))
      .limit(1),
    db.select({ status: subscription.status })
      .from(subscription)
      .where(and(
        eq(subscription.userId, customerId),
        inArray(subscription.status, ["active", "past_due", "trialing"]),
      ))
      // Match getActiveSubscription: live Stripe first, then newest live row.
      .orderBy(
        desc(sql`case when ${subscription.provider} = 'stripe' then 1 else 0 end`),
        desc(subscription.createdAt),
      )
      .limit(1),
  ]);

  const expiration = users[0]?.expirationDate;
  const hasAccess = options?.bypassStripe === true
    || (expiration != null && expiration.getTime() > (options?.now ?? new Date()).getTime());
  const subscriptionStatus = subscriptions[0]?.status ?? null;

  return {
    accountState: subscriptionStatus === "trialing" ? "trial" : hasAccess ? "active" : "legacy",
    defaultDurationDays: campaignDurationDays({ hasAccess, subscriptionStatus }),
  };
}
