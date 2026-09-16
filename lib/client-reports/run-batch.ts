import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildReportSnapshot } from "./build-snapshot";
import {
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
