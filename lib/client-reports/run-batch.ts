import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildReportSnapshot } from "./build-snapshot";
import {
  CLIENT_REPORTS_THRESHOLDS,
  isClientReportsEnabled,
  isClientReportsUserAllowed,
} from "./config";
import { lastCompleteMonth, lastCompleteWeek } from "./dates";
import { evaluateLifetimeAndRenewalMilestones, evaluateSnapshotMilestones } from "./milestones";
import type { ClientReportPeriodType } from "./payload-schema";

function allowedIds(userIds: string[] | undefined): string[] | null {
  if (!userIds?.length) return null;
  const allowed = userIds.filter((id) => isClientReportsUserAllowed(id));
  return allowed;
}

function idList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/** Every account that spent in the window and does not yet have this snapshot. */
async function pendingAccountUserIds(input: {
  periodType: ClientReportPeriodType;
  periodStart: string;
  periodEnd: string;
  userIds?: string[];
}): Promise<string[]> {
  const only = allowedIds(input.userIds);
  if (only && only.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT metrics.user_id::text AS user_id
    FROM meta_tracking_daily_metrics AS metrics
    WHERE metrics.entity_level = 'campaign'
      AND metrics.metric_date >= ${input.periodStart}
      AND metrics.metric_date <= ${input.periodEnd}
      AND metrics.spend::numeric > 0
      ${only ? sql`AND metrics.user_id::text IN (${idList(only)})` : sql``}
      AND NOT EXISTS (
        SELECT 1
        FROM client_report_snapshots AS snapshot
        WHERE snapshot.user_id = metrics.user_id
          AND snapshot.period_type = ${input.periodType}
          AND snapshot.period_start = ${input.periodStart}::date
          AND snapshot.campaign_id IS NULL
      )
    GROUP BY metrics.user_id
    ORDER BY metrics.user_id
  `);
  return (rows as unknown as Array<{ user_id: string }>)
    .map((row) => row.user_id)
    .filter((id) => id && isClientReportsUserAllowed(id));
}

/**
 * Accounts with recent spend, oldest milestone check first.
 * A tick that runs out of time resumes on the next cron instead of
 * permanently skipping the tail of the list.
 */
async function milestoneUserIds(userIds?: string[]): Promise<string[]> {
  const only = allowedIds(userIds);
  if (only && only.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT metrics.user_id::text AS user_id
    FROM meta_tracking_daily_metrics AS metrics
    LEFT JOIN (
      SELECT user_id, max(reached_at) AS last_reached
      FROM client_report_milestones
      GROUP BY user_id
    ) AS milestones ON milestones.user_id = metrics.user_id
    WHERE metrics.entity_level = 'campaign'
      AND metrics.metric_date >= (CURRENT_DATE - INTERVAL '45 days')
      AND metrics.spend::numeric > 0
      ${only ? sql`AND metrics.user_id::text IN (${idList(only)})` : sql``}
    GROUP BY metrics.user_id, milestones.last_reached
    ORDER BY milestones.last_reached ASC NULLS FIRST, metrics.user_id
  `);
  return (rows as unknown as Array<{ user_id: string }>)
    .map((row) => row.user_id)
    .filter((id) => id && isClientReportsUserAllowed(id));
}

function budgetExhausted(softDeadlineAt?: number): boolean {
  return softDeadlineAt !== undefined && Date.now() >= softDeadlineAt;
}

export async function runClientReportSnapshotBatch(input: {
  periodType: ClientReportPeriodType;
  userIds?: string[];
  softDeadlineAt?: number;
}) {
  if (!isClientReportsEnabled()) {
    return { skipped: true as const, reason: "disabled", built: 0, errors: 0 };
  }

  const week = lastCompleteWeek();
  const month = lastCompleteMonth();
  const period =
    input.periodType === "monthly"
      ? { start: month.start, end: month.end }
      : { start: week.start, end: week.end };

  const userIds = await pendingAccountUserIds({
    periodType: input.periodType,
    periodStart: period.start,
    periodEnd: period.end,
    userIds: input.userIds,
  });

  let built = 0;
  let errors = 0;
  let stoppedForBudget = false;
  const results: Array<{ userId: string; snapshotId?: string; error?: string }> =
    [];

  for (const userId of userIds) {
    if (budgetExhausted(input.softDeadlineAt)) {
      stoppedForBudget = true;
      break;
    }
    try {
      const snapshot = await buildReportSnapshot({
        userId,
        periodType: input.periodType,
        periodStart: period.start,
        periodEnd: period.end,
      });
      await evaluateSnapshotMilestones({
        userId,
        snapshotId: snapshot.snapshotId,
        monthsPaidBack: snapshot.monthsPaidBack,
        isPersonalBest: snapshot.isPersonalBest,
        purchaseValue: snapshot.payload.scorecard.purchaseValue,
        purchases: snapshot.payload.scorecard.purchases,
        roasAdjusted: snapshot.payload.scorecard.roasAdjusted,
      });
      built += 1;
      results.push({ userId, snapshotId: snapshot.snapshotId });
    } catch (error) {
      errors += 1;
      results.push({
        userId,
        error: error instanceof Error ? error.message : "build_failed",
      });
    }
  }

  return {
    skipped: false as const,
    periodType: input.periodType,
    periodStart: period.start,
    periodEnd: period.end,
    considered: userIds.length,
    built,
    errors,
    stoppedForBudget,
    remaining: Math.max(0, userIds.length - built - errors),
    results,
  };
}

export async function runClientCampaignReportBatch(input?: {
  userIds?: string[];
  softDeadlineAt?: number;
}) {
  if (!isClientReportsEnabled()) {
    return { skipped: true as const, reason: "disabled", built: 0, errors: 0 };
  }

  const period = lastCompleteWeek();
  const only = allowedIds(input?.userIds);
  if (only && only.length === 0) {
    return {
      skipped: false as const,
      periodStart: period.start,
      periodEnd: period.end,
      considered: 0,
      built: 0,
      errors: 0,
      stoppedForBudget: false,
      remaining: 0,
      results: [],
    };
  }
  const rows = await db.execute(sql`
    SELECT
      metrics.user_id::text AS user_id,
      metrics.entity_id AS campaign_id
    FROM meta_tracking_daily_metrics AS metrics
    WHERE metrics.entity_level = 'campaign'
      AND metrics.metric_date >= ${period.start}
      AND metrics.metric_date <= ${period.end}
      ${only ? sql`AND metrics.user_id::text IN (${idList(only)})` : sql``}
      AND NOT EXISTS (
        SELECT 1
        FROM client_report_snapshots AS snapshot
        WHERE snapshot.user_id = metrics.user_id
          AND snapshot.period_type = 'campaign'
          AND snapshot.period_start = ${period.start}::date
          AND snapshot.campaign_id = metrics.entity_id
      )
    GROUP BY metrics.user_id, metrics.entity_id
    HAVING COALESCE(sum(metrics.spend::numeric), 0) >= 20
      AND COALESCE(sum(metrics.purchase_value::numeric), 0)
          / NULLIF(COALESCE(sum(metrics.spend::numeric), 0), 0)
          >= ${CLIENT_REPORTS_THRESHOLDS.goodRoas}
    ORDER BY sum(metrics.purchase_value::numeric) DESC
  `);

  let built = 0;
  let errors = 0;
  let stoppedForBudget = false;
  const campaignRows = rows as unknown as Array<{
    user_id: string;
    campaign_id: string;
  }>;
  const results: Array<{
    userId: string;
    campaignId: string;
    snapshotId?: string;
    error?: string;
  }> = [];
  for (const row of campaignRows) {
    if (!isClientReportsUserAllowed(row.user_id)) continue;
    if (budgetExhausted(input?.softDeadlineAt)) {
      stoppedForBudget = true;
      break;
    }
    try {
      const snapshot = await buildReportSnapshot({
        userId: row.user_id,
        periodType: "campaign",
        periodStart: period.start,
        periodEnd: period.end,
        campaignId: row.campaign_id,
        generatedBy: "automatic",
      });
      built += 1;
      results.push({
        userId: row.user_id,
        campaignId: row.campaign_id,
        snapshotId: snapshot.snapshotId,
      });
    } catch (error) {
      errors += 1;
      results.push({
        userId: row.user_id,
        campaignId: row.campaign_id,
        error: error instanceof Error ? error.message : "build_failed",
      });
    }
  }
  return {
    skipped: false as const,
    periodStart: period.start,
    periodEnd: period.end,
    considered: campaignRows.length,
    built,
    errors,
    stoppedForBudget,
    remaining: Math.max(0, campaignRows.length - built - errors),
    results,
  };
}

export async function runClientReportMilestonesBatch(input?: {
  userIds?: string[];
  softDeadlineAt?: number;
}) {
  if (!isClientReportsEnabled()) {
    return { skipped: true as const, reason: "disabled", inserted: 0 };
  }
  const userIds = await milestoneUserIds(input?.userIds);

  let inserted = 0;
  let checked = 0;
  let stoppedForBudget = false;
  for (const userId of userIds) {
    if (budgetExhausted(input?.softDeadlineAt)) {
      stoppedForBudget = true;
      break;
    }
    inserted += await evaluateLifetimeAndRenewalMilestones(userId);
    checked += 1;
  }
  return {
    skipped: false as const,
    considered: userIds.length,
    checked,
    inserted,
    stoppedForBudget,
    remaining: Math.max(0, userIds.length - checked),
  };
}
