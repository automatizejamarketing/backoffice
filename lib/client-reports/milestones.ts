import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clientReportMilestone,
  clientReportSnapshot,
  metaTrackingDailyMetric,
  subscription,
  user,
} from "@/lib/db/schema";
import { daysUntil } from "./dates";
import { isClientReportPayloadV1 } from "./payload-schema";

const CUMULATIVE_SALES = [10_000, 50_000, 100_000, 500_000] as const;
const PAID_BACK_MONTHS = [1, 3, 6, 12] as const;

export type MilestoneCandidate = {
  milestoneKey: string;
  value: number | null;
  snapshotId?: string | null;
};

export async function recordMilestones(
  candidates: MilestoneCandidate[],
  userId: string,
): Promise<number> {
  let inserted = 0;
  for (const candidate of candidates) {
    const rows = await db
      .insert(clientReportMilestone)
      .values({
        userId,
        milestoneKey: candidate.milestoneKey,
        value: candidate.value !== null ? String(candidate.value) : null,
        snapshotId: candidate.snapshotId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: clientReportMilestone.id });
    inserted += rows.length;
  }
  return inserted;
}

export async function evaluateSnapshotMilestones(input: {
  userId: string;
  snapshotId: string;
  monthsPaidBack: number | null;
  isPersonalBest: boolean;
  purchaseValue: number;
  purchases: number;
  roasAdjusted: number | null;
}): Promise<number> {
  const candidates: MilestoneCandidate[] = [];

  if (input.purchases > 0 && input.purchaseValue > 0) {
    candidates.push({
      milestoneKey: "first_sale",
      value: input.purchaseValue,
      snapshotId: input.snapshotId,
    });
  }
  if (input.roasAdjusted !== null && input.roasAdjusted >= 2) {
    candidates.push({
      milestoneKey: "first_roas_2",
      value: input.roasAdjusted,
      snapshotId: input.snapshotId,
    });
  }
  if (input.isPersonalBest) {
    candidates.push({
      milestoneKey: `personal_best_week:${input.snapshotId}`,
      value: input.purchaseValue,
      snapshotId: input.snapshotId,
    });
  }
  if (input.monthsPaidBack !== null) {
    for (const months of PAID_BACK_MONTHS) {
      if (input.monthsPaidBack >= months) {
        candidates.push({
          milestoneKey: `paid_back_${months}`,
          value: input.monthsPaidBack,
          snapshotId: input.snapshotId,
        });
      }
    }
  }

  return recordMilestones(candidates, input.userId);
}

export async function evaluateLifetimeAndRenewalMilestones(userId: string) {
  const [lifetime] = await db
    .select({
      purchaseValue: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchaseValue}::numeric), 0)`,
      purchases: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchases}), 0)`,
    })
    .from(metaTrackingDailyMetric)
    .where(
      and(
        eq(metaTrackingDailyMetric.userId, userId),
        eq(metaTrackingDailyMetric.entityLevel, "campaign"),
      ),
    );

  const purchaseValue = Number.parseFloat(lifetime?.purchaseValue ?? "0") || 0;
  const purchases = Number.parseInt(lifetime?.purchases ?? "0", 10) || 0;
  const candidates: MilestoneCandidate[] = [];

  if (purchases > 0 && purchaseValue > 0) {
    candidates.push({
      milestoneKey: "first_sale",
      value: purchaseValue,
    });
  }
  for (const threshold of CUMULATIVE_SALES) {
    if (purchaseValue >= threshold) {
      candidates.push({
        milestoneKey: `cumulative_sales_${threshold}`,
        value: purchaseValue,
      });
    }
  }

  const [userRow] = await db
    .select({ expirationDate: user.expirationDate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const [sub] = await db
    .select({
      provider: subscription.provider,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(desc(subscription.updatedAt))
    .limit(1);

  if (userRow?.expirationDate) {
    const remaining = daysUntil(userRow.expirationDate);
    const expirationKey = userRow.expirationDate.toISOString().slice(0, 10);
    const pixLike =
      sub?.provider === "mercadopago" ||
      (sub?.provider as string | undefined) === "vindi";
    const windows = pixLike ? [30, 7, 2] : [30, 7];
    for (const days of windows) {
      if (remaining <= days && remaining >= 0) {
        candidates.push({
          milestoneKey: `renewal_recap_${days}:${expirationKey}`,
          value: remaining,
        });
      }
    }
  }

  const [latest] = await db
    .select()
    .from(clientReportSnapshot)
    .where(eq(clientReportSnapshot.userId, userId))
    .orderBy(desc(clientReportSnapshot.periodStart))
    .limit(1);
  if (latest && isClientReportPayloadV1(latest.payload)) {
    const months = latest.payload.paidBack.months;
    if (months !== null) {
      for (const threshold of PAID_BACK_MONTHS) {
        if (months >= threshold) {
          candidates.push({
            milestoneKey: `paid_back_${threshold}`,
            value: months,
            snapshotId: latest.id,
          });
        }
      }
    }
  }

  return recordMilestones(candidates, userId);
}
