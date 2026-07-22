import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceInsight,
  performanceSnapshot,
  performanceSnapshotRun,
} from "@/lib/db/schema";
import {
  PERFORMANCE_DROP_RULE_PREFIX,
  PERFORMANCE_DROP_RULEBOOK_VERSION,
  PERFORMANCE_DROP_WINDOW,
} from "@/lib/performance-drop/constants";
import { wasCapturedOnBusinessDay } from "@/lib/performance-drop/dates";
import type { PerformanceDropEvaluation } from "@/lib/performance-drop/evaluate";
import type { AccountWindowPair } from "@/lib/performance-drop/fetch-account-insights";

export async function createPerformanceDropRun(data: {
  triggeredBy: "manual" | "cron" | "script";
  requestedByEmail?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(performanceSnapshotRun)
    .values({
      triggeredBy: data.triggeredBy,
      requestedByEmail: data.requestedByEmail ?? null,
      status: "running",
      window: PERFORMANCE_DROP_WINDOW,
      rulebookVersion: PERFORMANCE_DROP_RULEBOOK_VERSION,
      summary: {
        adsEvaluated: 0,
        usersEvaluated: 0,
        adsetsEvaluated: 0,
        insightsCreated: 0,
        patternsCreated: 0,
        campaignsEvaluated: 0,
      },
    })
    .returning({ id: performanceSnapshotRun.id });

  if (!row) {
    throw new Error("Failed to create performance drop run");
  }
  return row.id;
}

export async function completePerformanceDropRun(
  runId: string,
  summary: {
    usersEvaluated: number;
    insightsCreated: number;
    dropCount: number;
    errorCount: number;
  },
): Promise<void> {
  await db
    .update(performanceSnapshotRun)
    .set({
      status: "completed",
      completedAt: new Date(),
      summary: {
        adsEvaluated: 0,
        usersEvaluated: summary.usersEvaluated,
        adsetsEvaluated: 0,
        insightsCreated: summary.insightsCreated,
        patternsCreated: 0,
        campaignsEvaluated: summary.dropCount,
        errorCount: summary.errorCount,
      },
    })
    .where(eq(performanceSnapshotRun.id, runId));
}

export async function failPerformanceDropRun(
  runId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(performanceSnapshotRun)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage,
    })
    .where(eq(performanceSnapshotRun.id, runId));
}

/** True when this user already has a drop-v1 snapshot captured today (SP). */
export async function wasPerformanceDropCheckedToday(
  userId: string,
  referenceDate = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({
      capturedAt: performanceSnapshot.capturedAt,
    })
    .from(performanceSnapshot)
    .innerJoin(
      performanceSnapshotRun,
      eq(performanceSnapshot.runId, performanceSnapshotRun.id),
    )
    .where(
      and(
        eq(performanceSnapshot.userId, userId),
        eq(
          performanceSnapshotRun.rulebookVersion,
          PERFORMANCE_DROP_RULEBOOK_VERSION,
        ),
      ),
    )
    .orderBy(desc(performanceSnapshot.capturedAt))
    .limit(1);

  return wasCapturedOnBusinessDay(row?.capturedAt ?? null, referenceDate);
}

export async function closeOpenPerformanceDropInsights(
  userId: string,
): Promise<void> {
  await db
    .update(performanceInsight)
    .set({
      status: "resolved",
      updatedAt: new Date(),
      reviewNote: "Superseded by newer performance-drop evaluation",
    })
    .where(
      and(
        eq(performanceInsight.userId, userId),
        eq(performanceInsight.status, "open"),
        like(performanceInsight.ruleId, `${PERFORMANCE_DROP_RULE_PREFIX}%`),
      ),
    );
}

export async function persistPerformanceDropForUser(args: {
  runId: string;
  userId: string;
  pairs: AccountWindowPair[];
  evaluation: PerformanceDropEvaluation;
}): Promise<{ insightCreated: boolean }> {
  const { runId, userId, pairs, evaluation } = args;
  const capturedAt = new Date();

  await closeOpenPerformanceDropInsights(userId);

  // One rollup snapshot per user. Account breakdown lives in payload (avoids
  // Postgres bind limits when a BM has 100+ ad accounts).
  const accountsSummary = pairs.map((pair) => ({
    accountId: pair.accountId,
    accountName: pair.accountName,
    current: pair.current,
    previous: pair.previous,
    currentRange: pair.currentRange,
    previousRange: pair.previousRange,
  }));

  await db.insert(performanceSnapshot).values({
    runId,
    userId,
    accountId: pairs.length === 1 ? pairs[0]?.accountId : null,
    entityLevel: "account",
    entityId: `user:${userId}`,
    entityName: "Account rollup",
    window: PERFORMANCE_DROP_WINDOW,
    metrics: {
      current: evaluation.current,
      previous: evaluation.previous,
      hasDrop: evaluation.hasDrop,
      severity: evaluation.severity,
      metric: evaluation.metric,
      dropRatio: evaluation.dropRatio,
      dropPercent: evaluation.dropPercent,
      sampleInsufficient: evaluation.sampleInsufficient,
      accountCount: pairs.length,
    },
    payload: {
      kind: "performance-drop",
      rulebookVersion: PERFORMANCE_DROP_RULEBOOK_VERSION,
      accounts: accountsSummary,
      evaluation,
    },
    capturedAt,
  });

  if (!evaluation.hasDrop || !evaluation.severity || !evaluation.ruleId) {
    return { insightCreated: false };
  }

  await db.insert(performanceInsight).values({
    runId,
    userId,
    ruleId: evaluation.ruleId,
    rulebookVersion: PERFORMANCE_DROP_RULEBOOK_VERSION,
    severity: evaluation.severity,
    confidence: evaluation.sampleInsufficient ? "low" : "medium",
    entityLevel: "account",
    entityId: `user:${userId}`,
    entityName: "Account rollup",
    actionType: "investigate_drop",
    title: evaluation.title,
    evidence: evaluation.evidence,
    recommendation: evaluation.recommendation,
    metrics: {
      current: evaluation.current,
      previous: evaluation.previous,
      metric: evaluation.metric,
      dropRatio: evaluation.dropRatio,
      dropPercent: evaluation.dropPercent,
    },
    status: "open",
  });

  return { insightCreated: true };
}
