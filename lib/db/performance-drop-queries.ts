import { and, desc, eq, like, lt } from "drizzle-orm";
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

/**
 * Runs stuck in `running` longer than this are marked failed before a new run.
 * Sized just above Vercel cron `maxDuration` (300s) so a killed invocation is
 * reclaimable on the next create without waiting half an hour.
 */
const STUCK_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export async function markStuckPerformanceDropRunsFailed(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_RUN_TIMEOUT_MS);
  const updated = await db
    .update(performanceSnapshotRun)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: `Timed out: still running after ${STUCK_RUN_TIMEOUT_MS / 60000} minutes`,
    })
    .where(
      and(
        eq(performanceSnapshotRun.status, "running"),
        eq(
          performanceSnapshotRun.rulebookVersion,
          PERFORMANCE_DROP_RULEBOOK_VERSION,
        ),
        lt(performanceSnapshotRun.startedAt, cutoff),
      ),
    )
    .returning({ id: performanceSnapshotRun.id });

  return updated.length;
}

export async function createPerformanceDropRun(data: {
  triggeredBy: "manual" | "cron" | "script";
  requestedByEmail?: string | null;
}): Promise<string> {
  await markStuckPerformanceDropRunsFailed();

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

/**
 * True when this user already has a successful drop-v1 evaluation today (SP).
 * Error markers do not count — cron `onlyStale` may retry same-day failures.
 */
export async function wasPerformanceDropCheckedToday(
  userId: string,
  referenceDate = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({
      capturedAt: performanceSnapshot.capturedAt,
      metrics: performanceSnapshot.metrics,
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

  if (!row) {
    return false;
  }

  const metrics = row.metrics as { error?: boolean } | null;
  if (metrics?.error === true) {
    return false;
  }

  return wasCapturedOnBusinessDay(row.capturedAt, referenceDate);
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

  return db.transaction(async (tx) => {
    await tx
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

    await tx.insert(performanceSnapshot).values({
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

    await tx.insert(performanceInsight).values({
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
  });
}

/**
 * Persist a same-day check marker after a per-user failure without closing or
 * opening drop insights (avoids incorrect resolution on transient errors).
 */
export async function persistPerformanceDropCheckFailure(args: {
  runId: string;
  userId: string;
  errorMessage: string;
}): Promise<void> {
  const { runId, userId, errorMessage } = args;
  const emptyMetrics = {
    spend: 0,
    purchases: 0,
    purchaseValue: 0,
    roas: 0,
  };

  await db.insert(performanceSnapshot).values({
    runId,
    userId,
    accountId: null,
    entityLevel: "account",
    entityId: `user:${userId}`,
    entityName: "Account rollup",
    window: PERFORMANCE_DROP_WINDOW,
    metrics: {
      current: emptyMetrics,
      previous: emptyMetrics,
      hasDrop: false,
      severity: null,
      metric: null,
      dropRatio: null,
      dropPercent: null,
      sampleInsufficient: true,
      accountCount: 0,
      error: true,
    },
    payload: {
      kind: "performance-drop",
      rulebookVersion: PERFORMANCE_DROP_RULEBOOK_VERSION,
      accounts: [],
      errorMessage,
      evaluation: {
        hasDrop: false,
        severity: null,
        metric: null,
        ruleId: null,
        dropRatio: null,
        dropPercent: null,
        previous: emptyMetrics,
        current: emptyMetrics,
        sampleInsufficient: true,
        title: "Falha ao avaliar queda de performance",
        evidence: errorMessage,
        recommendation: "Reexecutar a verificação de performance.",
      },
    },
    capturedAt: new Date(),
  });
}
