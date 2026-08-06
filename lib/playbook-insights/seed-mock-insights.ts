import { eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  completePlaybookInsightsRun,
  createPlaybookInsightsRun,
  persistPlaybookInsightsForUser,
} from "@/lib/db/playbook-insights-queries";
import { buildMockPlaybookEvaluation } from "./mock-evaluation";

export type SeedMockPlaybookInsightsResult = {
  userId: string;
  email: string;
  runId: string;
  insightsCreated: number;
  candidateCount: number;
};

export async function resolveUserIdForMockSeed(args: {
  userId?: string | null;
  email?: string | null;
}): Promise<{ userId: string; email: string } | null> {
  if (args.userId) {
    const [row] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, args.userId))
      .limit(1);
    return row ? { userId: row.id, email: row.email } : null;
  }

  if (args.email) {
    const [row] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(ilike(user.email, args.email.trim()))
      .limit(1);
    return row ? { userId: row.id, email: row.email } : null;
  }

  return null;
}

/**
 * Persist synthetic playbook insights for UI demos (staging/local only).
 */
export async function seedMockPlaybookInsights(args: {
  userId: string;
  email: string;
}): Promise<SeedMockPlaybookInsightsResult> {
  const evaluation = buildMockPlaybookEvaluation();
  const runId = await createPlaybookInsightsRun({
    triggeredBy: "manual",
    requestedByEmail: `mock-seed:${args.email}`,
  });

  const persisted = await persistPlaybookInsightsForUser({
    runId,
    userId: args.userId,
    evaluation,
  });

  await completePlaybookInsightsRun(runId, {
    usersEvaluated: 1,
    insightsCreated: persisted.insightsCreated,
    campaignsEvaluated: evaluation.campaigns.length,
    errorCount: 0,
  });

  return {
    userId: args.userId,
    email: args.email,
    runId,
    insightsCreated: persisted.insightsCreated,
    candidateCount: evaluation.candidates.length,
  };
}
