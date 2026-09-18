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

async function eligibleUserIds(maxUsers = 200): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT user_id::text AS user_id
    FROM meta_tracking_daily_metrics
    ORDER BY user_id
    LIMIT ${maxUsers}
  `);
  return (rows as unknown as Array<{ user_id: string }>)
    .map((row) => row.user_id)
    .filter(Boolean);
}

export async function runClientReportSnapshotBatch(input: {
  periodType: ClientReportPeriodType;
  userIds?: string[];
  maxUsers?: number;
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

  const requested = input.userIds?.length
    ? input.userIds
    : await eligibleUserIds(input.maxUsers ?? 200);
  const userIds = requested.filter((id) => isClientReportsUserAllowed(id));

  let built = 0;
  let errors = 0;
  const results: Array<{ userId: string; snapshotId?: string; error?: string }> =
    [];

  for (const userId of userIds) {
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
    results,
  };
}

export async function runClientCampaignReportBatch(input?: {
  userIds?: string[];
  maxCampaigns?: number;
}) {
  if (!isClientReportsEnabled()) {
    return { skipped: true as const, reason: "disabled", built: 0, errors: 0 };
  }

  const period = lastCompleteWeek();
  const allowedUsers = input?.userIds?.filter((id) =>
    isClientReportsUserAllowed(id),
  );
  const rows = await db.execute(sql`
    SELECT
      user_id::text AS user_id,
      entity_id AS campaign_id,
      COALESCE(sum(spend::numeric), 0)::numeric AS spend,
      COALESCE(sum(purchase_value::numeric), 0)::numeric AS purchase_value
    FROM meta_tracking_daily_metrics
    WHERE entity_level = 'campaign'
      AND metric_date >= ${period.start}
      AND metric_date <= ${period.end}
      ${
        allowedUsers?.length
          ? sql`AND user_id::text IN (${sql.join(
              allowedUsers.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql``
      }
    GROUP BY user_id, entity_id
    HAVING COALESCE(sum(spend::numeric), 0) >= 20
      AND COALESCE(sum(purchase_value::numeric), 0)
          / NULLIF(COALESCE(sum(spend::numeric), 0), 0)
          >= ${CLIENT_REPORTS_THRESHOLDS.goodRoas}
    ORDER BY purchase_value DESC
    LIMIT ${input?.maxCampaigns ?? 300}
  `);

  let built = 0;
  let errors = 0;
  const results: Array<{
    userId: string;
    campaignId: string;
    snapshotId?: string;
    error?: string;
  }> = [];
  for (const row of rows as unknown as Array<{
    user_id: string;
    campaign_id: string;
  }>) {
    if (!isClientReportsUserAllowed(row.user_id)) continue;
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
    considered: rows.length,
    built,
    errors,
    results,
  };
}

export async function runClientReportMilestonesBatch(input?: {
  userIds?: string[];
  maxUsers?: number;
}) {
  if (!isClientReportsEnabled()) {
    return { skipped: true as const, reason: "disabled", inserted: 0 };
  }
  const userIds = (
    input?.userIds?.length
      ? input.userIds
      : await eligibleUserIds(input?.maxUsers ?? 200)
  ).filter((id) => isClientReportsUserAllowed(id));

  let inserted = 0;
  for (const userId of userIds) {
    inserted += await evaluateLifetimeAndRenewalMilestones(userId);
  }
  return { skipped: false as const, considered: userIds.length, inserted };
}
