import { and, eq, inArray, like, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  performanceInsight,
  performanceSnapshot,
  performanceSnapshotRun,
} from "@/lib/db/schema";
import {
  ACCOUNT_ALERTS_RULE_PREFIX,
  ACCOUNT_ALERTS_RULEBOOK_VERSION,
  ACCOUNT_ALERTS_WINDOW,
} from "./constants";
import type { AccountAlertCandidate } from "./evaluate";

const STUCK_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export type CreatedAccountAlert = {
  id: string;
  userId: string;
  ruleId: string;
  title: string;
  evidence: string;
  entityName: string | null;
};

export async function createAccountAlertsRun(data: {
  triggeredBy: "manual" | "cron";
}): Promise<string> {
  const cutoff = new Date(Date.now() - STUCK_RUN_TIMEOUT_MS);
  await db
    .update(performanceSnapshotRun)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: `Timed out: still running after ${STUCK_RUN_TIMEOUT_MS / 60000} minutes`,
    })
    .where(
      and(
        eq(performanceSnapshotRun.status, "running"),
        eq(performanceSnapshotRun.rulebookVersion, ACCOUNT_ALERTS_RULEBOOK_VERSION),
        lt(performanceSnapshotRun.startedAt, cutoff),
      ),
    );

  const [row] = await db
    .insert(performanceSnapshotRun)
    .values({
      triggeredBy: data.triggeredBy,
      status: "running",
      window: ACCOUNT_ALERTS_WINDOW,
      rulebookVersion: ACCOUNT_ALERTS_RULEBOOK_VERSION,
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

  if (!row) throw new Error("Failed to create account alerts run");
  return row.id;
}

export async function completeAccountAlertsRun(
  runId: string,
  summary: { usersEvaluated: number; insightsCreated: number; errorCount: number },
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
        campaignsEvaluated: 0,
        errorCount: summary.errorCount,
      },
    })
    .where(eq(performanceSnapshotRun.id, runId));
}

export async function failAccountAlertsRun(
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

export async function persistAccountAlertsForUser(args: {
  runId: string;
  userId: string;
  clientName: string | null;
  candidates: AccountAlertCandidate[];
}): Promise<CreatedAccountAlert[]> {
  const candidateKeys = new Set(
    args.candidates.map((candidate) => `${candidate.ruleId}:${candidate.entityId}`),
  );

  return db.transaction(async (tx) => {
    await tx.insert(performanceSnapshot).values({
      runId: args.runId,
      userId: args.userId,
      accountId: null,
      entityLevel: "account",
      entityId: `user:${args.userId}`,
      entityName: args.clientName,
      window: ACCOUNT_ALERTS_WINDOW,
      metrics: { candidateCount: args.candidates.length },
      payload: {
        kind: "account-alerts",
        rulebookVersion: ACCOUNT_ALERTS_RULEBOOK_VERSION,
        candidates: args.candidates,
      },
      capturedAt: new Date(),
    });

    const activeRows = await tx
      .select()
      .from(performanceInsight)
      .where(
        and(
          eq(performanceInsight.userId, args.userId),
          inArray(performanceInsight.status, [
            "open",
            "acknowledged",
            "done",
            "dismissed",
          ]),
          like(performanceInsight.ruleId, `${ACCOUNT_ALERTS_RULE_PREFIX}%`),
        ),
      );

    for (const row of activeRows) {
      const key = `${row.ruleId}:${row.entityId}`;
      if (!candidateKeys.has(key)) {
        await tx
          .update(performanceInsight)
          .set({
            status: "resolved",
            updatedAt: new Date(),
            reviewNote: "Condition no longer holds (account re-evaluation)",
          })
          .where(eq(performanceInsight.id, row.id));
      }
    }

    const created: CreatedAccountAlert[] = [];
    for (const candidate of args.candidates) {
      const existing = activeRows.find(
        (row) =>
          row.ruleId === candidate.ruleId && row.entityId === candidate.entityId,
      );

      if (existing?.status === "done" || existing?.status === "dismissed") {
        continue;
      }

      if (existing) {
        await tx
          .update(performanceInsight)
          .set({
            runId: args.runId,
            title: candidate.title,
            evidence: candidate.evidence,
            recommendation: candidate.recommendation,
            severity: candidate.severity,
            confidence: candidate.confidence,
            actionType: candidate.actionType,
            entityName: candidate.entityName,
            metrics: candidate.metrics,
            rulebookVersion: ACCOUNT_ALERTS_RULEBOOK_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(performanceInsight.id, existing.id));
        continue;
      }

      const [inserted] = await tx
        .insert(performanceInsight)
        .values({
          runId: args.runId,
          userId: args.userId,
          ruleId: candidate.ruleId,
          rulebookVersion: ACCOUNT_ALERTS_RULEBOOK_VERSION,
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
        })
        .returning({ id: performanceInsight.id });

      if (!inserted) continue;
      created.push({
        id: inserted.id,
        userId: args.userId,
        ruleId: candidate.ruleId,
        title: candidate.title,
        evidence: candidate.evidence,
        entityName: candidate.entityName,
      });
    }

    return created;
  });
}
