import { sql } from "drizzle-orm";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";
import { db } from "@/lib/db";
import {
  metaBusinessAccount,
  payment,
  performanceInsight,
  subscription,
  user,
} from "@/lib/db/schema";
import {
  ACCOUNT_ALERT_LOAD_LOOKBACK_DAYS,
  ACCOUNT_ALERTS_RULE_PREFIX,
} from "./constants";
import type { AccountAlertSubject } from "./evaluate";

const DAY_MS = 24 * 60 * 60 * 1000;

type AccountAlertRow = {
  user_id: string;
  email: string;
  name: string | null;
  expiration_date: Date | string | null;
  has_meta: boolean;
  campaign_checked: boolean;
  has_active_managed_campaign: boolean;
  last_payment_provider: string | null;
  last_payment_method: string | null;
  subscription_provider: string | null;
  subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: Date | string | null;
  failed_at: Date | string | null;
  failure_reason: string | null;
  last_success_at: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function daysUntil(now: Date, target: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
}

function daysSince(now: Date, target: Date): number {
  return Math.floor((now.getTime() - target.getTime()) / DAY_MS);
}

function unwrapRows(result: unknown): AccountAlertRow[] {
  if (Array.isArray(result)) return result as AccountAlertRow[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: AccountAlertRow[] }).rows;
  }
  return [];
}

function isPixPayment(provider: string | null, method: string | null): boolean {
  if (provider === "mercadopago") return true;
  return provider === "vindi" && method === "pix";
}

export async function loadAccountAlertSubjects(
  now: Date = new Date(),
): Promise<AccountAlertSubject[]> {
  const billingPurpose = billingPaymentPurposeSql("p.purpose");
  const rows = await db.execute(sql`
    SELECT
      ${user.id} AS user_id,
      ${user.email} AS email,
      ${user.name} AS name,
      ${user.expirationDate} AS expiration_date,
      EXISTS (
        SELECT 1
        FROM ${metaBusinessAccount} mba
        WHERE mba.user_id = ${user.id}
          AND mba.deleted_at IS NULL
      ) AS has_meta,
      EXISTS (
        SELECT 1
        FROM business_managed_campaign_cache c
        WHERE c.user_id = ${user.id}
      ) AS campaign_checked,
      EXISTS (
        SELECT 1
        FROM business_managed_campaign_cache c
        WHERE c.user_id = ${user.id}
          AND c.has_active_managed_campaign = true
      ) AS has_active_managed_campaign,
      pay.provider AS last_payment_provider,
      pay.payment_method AS last_payment_method,
      pay.paid_at AS last_success_at,
      sub.provider AS subscription_provider,
      sub.status AS subscription_status,
      sub.cancel_at_period_end AS cancel_at_period_end,
      sub.canceled_at AS canceled_at,
      fail.created_at AS failed_at,
      fail.failure_reason AS failure_reason
    FROM ${user}
    LEFT JOIN LATERAL (
      SELECT p.provider, p.payment_method, COALESCE(p.paid_at, p.created_at) AS paid_at
      FROM ${payment} p
      WHERE p.user_id = ${user.id}
        AND p.status = 'succeeded'
        AND ${billingPurpose}
      ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
      LIMIT 1
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT
        s.provider,
        s.status,
        s.cancel_at_period_end,
        s.canceled_at
      FROM ${subscription} s
      WHERE s.user_id = ${user.id}
      ORDER BY CASE s.status
        WHEN 'active' THEN 6
        WHEN 'trialing' THEN 5
        WHEN 'past_due' THEN 4
        WHEN 'incomplete' THEN 3
        WHEN 'unpaid' THEN 2
        WHEN 'canceled' THEN 1
        ELSE 0
      END DESC, s.created_at DESC
      LIMIT 1
    ) sub ON true
    LEFT JOIN LATERAL (
      SELECT p.created_at, p.failure_reason
      FROM ${payment} p
      WHERE p.user_id = ${user.id}
        AND p.status = 'failed'
        AND p.provider IN ('stripe', 'vindi')
        AND COALESCE(p.payment_method, 'credit_card') <> 'pix'
        AND ${billingPurpose}
      ORDER BY p.created_at DESC
      LIMIT 1
    ) fail ON true
    WHERE (
      ${user.expirationDate} > now()
      OR sub.status IN ('past_due', 'unpaid', 'incomplete')
      OR (
        sub.status = 'canceled'
        AND sub.canceled_at > now() - make_interval(days => ${ACCOUNT_ALERT_LOAD_LOOKBACK_DAYS})
      )
      OR fail.created_at > now() - make_interval(days => ${ACCOUNT_ALERT_LOAD_LOOKBACK_DAYS})
      OR EXISTS (
        SELECT 1
        FROM ${performanceInsight} pi
        WHERE pi.user_id = ${user.id}
          AND pi.status = 'open'
          AND pi.rule_id LIKE ${`${ACCOUNT_ALERTS_RULE_PREFIX}%`}
      )
    )
  `);

  const list = unwrapRows(rows);
  return list.map((row) => {
    const expiration = asDate(row.expiration_date);
    const canceledAt = asDate(row.canceled_at);
    const failedAt = asDate(row.failed_at);
    const lastSuccessAt = asDate(row.last_success_at);
    const failureIsCurrent =
      failedAt !== null &&
      (lastSuccessAt === null || failedAt.getTime() > lastSuccessAt.getTime());

    return {
      userId: row.user_id,
      clientName: row.name?.trim() || row.email,
      hasActiveAccess: expiration !== null && expiration.getTime() > now.getTime(),
      hasMeta: asBoolean(row.has_meta),
      campaignChecked: asBoolean(row.campaign_checked),
      hasActiveManagedCampaign: asBoolean(row.has_active_managed_campaign),
      lastPaymentIsPix: isPixPayment(
        row.last_payment_provider,
        row.last_payment_method,
      ),
      daysUntilExpiration: expiration ? daysUntil(now, expiration) : null,
      subscriptionProvider: row.subscription_provider,
      subscriptionStatus: row.subscription_status,
      cancelAtPeriodEnd: asBoolean(row.cancel_at_period_end),
      daysSinceCanceled: canceledAt ? daysSince(now, canceledAt) : null,
      daysSinceCardFailure:
        failureIsCurrent && failedAt ? daysSince(now, failedAt) : null,
      cardFailureReason: failureIsCurrent ? row.failure_reason : null,
    };
  });
}
