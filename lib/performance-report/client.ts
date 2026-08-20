import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  metaBusinessAccount,
  payment,
  subscription,
  user,
} from "@/lib/db/schema";

export type ReportClient = {
  userId: string;
  email: string;
  name: string | null;
  planType: string | null;
  renewalDate: Date | null;
  metaConnected: boolean;
  metaConnectionStatus: string | null;
  assignedAdAccounts: Array<{ id: string; accountId?: string; name?: string }>;
};

export type LatestPayment = {
  amountCentavos: number;
  currency: string;
  planType: string | null;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  commitmentMonths: number | null;
};

type AssignedAssets = {
  adAccounts?: Array<{ id?: string; accountId?: string; name?: string }>;
};

function parseAssignedAccounts(assets: unknown): ReportClient["assignedAdAccounts"] {
  if (!assets || typeof assets !== "object") return [];
  const list = (assets as AssignedAssets).adAccounts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((account) => typeof account.id === "string")
    .slice(0, 25)
    .map((account) => ({
      id: account.id as string,
      accountId: account.accountId,
      name: account.name,
    }));
}

export async function getReportClientByUserId(
  userId: string,
): Promise<ReportClient | null> {
  const [foundUser] = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      expirationDate: user.expirationDate,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!foundUser) return null;

  const [sub] = await db
    .select({
      planType: subscription.planType,
      currentPeriodEnd: subscription.currentPeriodEnd,
      status: subscription.status,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(
      sql`CASE ${subscription.status}
        WHEN 'active' THEN 1
        WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3
        WHEN 'unpaid' THEN 4
        WHEN 'incomplete' THEN 5
        WHEN 'canceled' THEN 6
        WHEN 'incomplete_expired' THEN 7
        ELSE 99
      END`,
      desc(subscription.createdAt),
    )
    .limit(1);

  const [meta] = await db
    .select({
      connectionStatus: metaBusinessAccount.connectionStatus,
      assignedAssets: metaBusinessAccount.assignedAssets,
    })
    .from(metaBusinessAccount)
    .where(
      and(
        eq(metaBusinessAccount.userId, userId),
        isNull(metaBusinessAccount.deletedAt),
      ),
    )
    .orderBy(desc(metaBusinessAccount.updatedAt))
    .limit(1);

  return {
    userId: foundUser.userId,
    email: foundUser.email,
    name: foundUser.name,
    planType: sub?.planType ?? null,
    renewalDate: sub?.currentPeriodEnd ?? foundUser.expirationDate ?? null,
    metaConnected: Boolean(meta),
    metaConnectionStatus: meta?.connectionStatus ?? null,
    assignedAdAccounts: parseAssignedAccounts(meta?.assignedAssets),
  };
}

export async function getReportClientByEmail(
  email: string,
): Promise<ReportClient | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const [found] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1);
  if (!found) return null;
  return getReportClientByUserId(found.id);
}

export async function getLatestSucceededPayment(
  userId: string,
): Promise<LatestPayment | null> {
  const [sub] = await db
    .select({
      id: subscription.id,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      commitmentMonths: subscription.commitmentMonths,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(
      sql`CASE ${subscription.status}
        WHEN 'active' THEN 1
        WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3
        WHEN 'unpaid' THEN 4
        WHEN 'incomplete' THEN 5
        WHEN 'canceled' THEN 6
        WHEN 'incomplete_expired' THEN 7
        ELSE 99
      END`,
      desc(subscription.createdAt),
    )
    .limit(1);
  if (!sub) return null;

  const [row] = await db
    .select({
      amount: payment.amount,
      currency: payment.currency,
      planType: payment.planType,
      paidAt: payment.paidAt,
    })
    .from(payment)
    .where(
      and(eq(payment.subscriptionId, sub.id), eq(payment.status, "succeeded")),
    )
    .orderBy(sql`COALESCE(${payment.paidAt}, ${payment.createdAt}) DESC`)
    .limit(1);
  if (!row) return null;

  return {
    amountCentavos: row.amount,
    currency: row.currency,
    planType: row.planType,
    paidAt: row.paidAt,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    commitmentMonths: sub.commitmentMonths,
  };
}
