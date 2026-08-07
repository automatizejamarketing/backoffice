import { and, desc, eq, inArray, like, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceInsight,
  performanceSnapshot,
  performanceSnapshotRun,
  type PerformanceInsight,
} from "@/lib/db/schema";
import {
  PLAYBOOK_INSIGHTS_RULE_PREFIX,
  PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
  PLAYBOOK_INSIGHTS_WINDOW,
} from "@/lib/playbook-insights/constants";
import type {
  PlaybookEvaluationResult,
  PlaybookInsightCandidate,
} from "@/lib/playbook-insights/types";

const STUCK_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export type PlaybookInsightSummary = {
  openCount: number;
  highestSeverity: "critical" | "warning" | "info" | null;
};

export async function markStuckPlaybookInsightRunsFailed(): Promise<number> {
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
          PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
        ),
        lt(performanceSnapshotRun.startedAt, cutoff),
      ),
    )
    .returning({ id: performanceSnapshotRun.id });

  return updated.length;
}

export async function createPlaybookInsightsRun(data: {
  triggeredBy: "manual" | "cron" | "script";
  requestedByEmail?: string | null;
}): Promise<string> {
  await markStuckPlaybookInsightRunsFailed();

  const [row] = await db
    .insert(performanceSnapshotRun)
    .values({
      triggeredBy: data.triggeredBy,
      requestedByEmail: data.requestedByEmail ?? null,
      status: "running",
      window: PLAYBOOK_INSIGHTS_WINDOW,
      rulebookVersion: PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
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
    throw new Error("Failed to create playbook insights run");
  }
  return row.id;
}

export async function completePlaybookInsightsRun(
  runId: string,
  summary: {
    usersEvaluated: number;
    insightsCreated: number;
    campaignsEvaluated: number;
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
        campaignsEvaluated: summary.campaignsEvaluated,
        errorCount: summary.errorCount,
      },
    })
    .where(eq(performanceSnapshotRun.id, runId));
}

export async function failPlaybookInsightsRun(
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

export type NewlyCreatedPlaybookInsight = {
  ruleId: string;
  entityId: string;
  title: string;
  evidence: string;
  recommendation: string;
  severity: string;
  entityName: string | null;
};

export async function persistPlaybookInsightsForUser(args: {
  runId: string;
  userId: string;
  evaluation: PlaybookEvaluationResult;
}): Promise<{
  insightsCreated: number;
  createdInsights: NewlyCreatedPlaybookInsight[];
}> {
  const { runId, userId, evaluation } = args;
  const capturedAt = new Date();
  const candidateKeys = new Set(
    evaluation.candidates.map(
      (candidate) => `${candidate.ruleId}:${candidate.entityId}`,
    ),
  );

  return db.transaction(async (tx) => {
    await tx.insert(performanceSnapshot).values({
      runId,
      userId,
      accountId: evaluation.accountId,
      entityLevel: "account",
      entityId: `user:${userId}`,
      entityName: "Playbook campaign rollup",
      window: PLAYBOOK_INSIGHTS_WINDOW,
      metrics: {
        campaignCount: evaluation.campaigns.length,
        candidateCount: evaluation.candidates.length,
        accountId: evaluation.accountId,
      },
      payload: {
        kind: "playbook-insights",
        rulebookVersion: PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
        campaigns: evaluation.campaigns,
        candidates: evaluation.candidates,
      },
      capturedAt,
    });

    const openRows = await tx
      .select()
      .from(performanceInsight)
      .where(
        and(
          eq(performanceInsight.userId, userId),
          eq(performanceInsight.status, "open"),
          like(
            performanceInsight.ruleId,
            `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`,
          ),
        ),
      );

    for (const row of openRows) {
      const key = `${row.ruleId}:${row.entityId}`;
      if (!candidateKeys.has(key)) {
        await tx
          .update(performanceInsight)
          .set({
            status: "resolved",
            updatedAt: new Date(),
            reviewNote: "Condition no longer holds (playbook re-evaluation)",
          })
          .where(eq(performanceInsight.id, row.id));
      }
    }

    let insightsCreated = 0;
    const createdInsights: NewlyCreatedPlaybookInsight[] = [];
    for (const candidate of evaluation.candidates) {
      const existing = openRows.find(
        (row) =>
          row.ruleId === candidate.ruleId &&
          row.entityId === candidate.entityId,
      );

      if (existing) {
        await tx
          .update(performanceInsight)
          .set({
            runId,
            title: candidate.title,
            evidence: candidate.evidence,
            recommendation: candidate.recommendation,
            severity: candidate.severity,
            confidence: candidate.confidence,
            actionType: candidate.actionType,
            entityName: candidate.entityName,
            metrics: candidate.metrics,
            rulebookVersion: PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(performanceInsight.id, existing.id));
        continue;
      }

      await tx.insert(performanceInsight).values({
        runId,
        userId,
        ruleId: candidate.ruleId,
        rulebookVersion: PLAYBOOK_INSIGHTS_RULEBOOK_VERSION,
        severity: candidate.severity,
        confidence: candidate.confidence,
        entityLevel: candidate.entityLevel,
        entityId: candidate.entityId,
        entityName: candidate.entityName,
        actionType: candidate.actionType,
        title: candidate.title,
        evidence: candidate.evidence,
        recommendation: candidate.recommendation,
        metrics: candidate.metrics,
        status: "open",
      });
      insightsCreated += 1;
      createdInsights.push({
        ruleId: candidate.ruleId,
        entityId: candidate.entityId ?? "",
        title: candidate.title,
        evidence: candidate.evidence,
        recommendation: candidate.recommendation,
        severity: candidate.severity,
        entityName: candidate.entityName ?? null,
      });
    }

    return { insightsCreated, createdInsights };
  });
}

export async function listOpenPlaybookInsightsForUser(
  userId: string,
  limit = 20,
): Promise<PerformanceInsight[]> {
  const rows = await db
    .select()
    .from(performanceInsight)
    .where(
      and(
        eq(performanceInsight.userId, userId),
        eq(performanceInsight.status, "open"),
        like(performanceInsight.ruleId, `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`),
      ),
    )
    .orderBy(desc(performanceInsight.updatedAt))
    .limit(limit);

  const severityRank: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return rows.sort((a, b) => {
    const rank =
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    if (rank !== 0) return rank;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export async function updatePlaybookInsightStatus(args: {
  insightId: string;
  userId: string;
  status: "acknowledged" | "done" | "dismissed";
  reviewedByEmail: string;
  reviewNote?: string | null;
}): Promise<PerformanceInsight | null> {
  const mappedStatus =
    args.status === "acknowledged"
      ? "acknowledged"
      : args.status === "done"
        ? "done"
        : "dismissed";

  const [updated] = await db
    .update(performanceInsight)
    .set({
      status: mappedStatus,
      reviewedByEmail: args.reviewedByEmail,
      reviewNote: args.reviewNote ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(performanceInsight.id, args.insightId),
        eq(performanceInsight.userId, args.userId),
        eq(performanceInsight.status, "open"),
        like(performanceInsight.ruleId, `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function getPlaybookInsightSummariesForUsers(
  userIds: string[],
): Promise<Map<string, PlaybookInsightSummary>> {
  const result = new Map<string, PlaybookInsightSummary>();
  if (userIds.length === 0) return result;

  for (const userId of userIds) {
    result.set(userId, { openCount: 0, highestSeverity: null });
  }

  const rows = await db
    .select({
      userId: performanceInsight.userId,
      severity: performanceInsight.severity,
      openCount: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .where(
      and(
        inArray(performanceInsight.userId, userIds),
        eq(performanceInsight.status, "open"),
        like(performanceInsight.ruleId, `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`),
      ),
    )
    .groupBy(performanceInsight.userId, performanceInsight.severity);

  const rank: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  for (const row of rows) {
    const current = result.get(row.userId) ?? {
      openCount: 0,
      highestSeverity: null as PlaybookInsightSummary["highestSeverity"],
    };
    current.openCount += Number(row.openCount);
    const severity = row.severity as PlaybookInsightSummary["highestSeverity"];
    if (
      severity &&
      (current.highestSeverity === null ||
        (rank[severity] ?? 9) < (rank[current.highestSeverity] ?? 9))
    ) {
      current.highestSeverity = severity;
    }
    result.set(row.userId, current);
  }

  return result;
}
