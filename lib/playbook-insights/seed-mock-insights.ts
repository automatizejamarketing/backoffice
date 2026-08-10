import { eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { getConsultantPlaybookAlertConfig } from "@/lib/db/proactivity-alert-queries";
import {
  completePlaybookInsightsRun,
  createPlaybookInsightsRun,
  persistPlaybookInsightsForUser,
} from "@/lib/db/playbook-insights-queries";
import { isMetaFakeScenarioUser } from "@/lib/meta-fake/config";
import {
  buildFullDemoCampaignMetrics,
  FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
} from "@/lib/meta-fake/full-demo-campaigns";
import { evaluatePlaybookInsights } from "./evaluate";
import { deliverPlaybookInsightsToSlack } from "@/lib/proactivity/slack-delivery";

export type SeedMockPlaybookInsightsResult = {
  userId: string;
  email: string;
  runId: string;
  insightsCreated: number;
  candidateCount: number;
  scenario: "full_demo";
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
 * Persist synthetic playbook insights for an allowlisted fake-scenario user
 * using DB-configured thresholds/persistence (staging/local only).
 */
export async function seedMockPlaybookInsights(args: {
  userId: string;
  email: string;
}): Promise<SeedMockPlaybookInsightsResult> {
  if (!isMetaFakeScenarioUser(args.userId)) {
    throw new Error(
      "User is not in META_FAKE_SCENARIO_USER_IDS (or fake mode is disabled)",
    );
  }

  const now = new Date();
  const alertConfig = await getConsultantPlaybookAlertConfig();
  const campaigns = buildFullDemoCampaignMetrics(now);
  const evaluation = evaluatePlaybookInsights({
    accountId: FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
    campaigns,
    now,
    config: {
      enabledRuleIds: alertConfig.enabledPlaybookRuleIds,
      thresholdsByRuleId: alertConfig.thresholdsByPlaybookRuleId,
    },
  });

  const runId = await createPlaybookInsightsRun({
    triggeredBy: "manual",
    requestedByEmail: `fake-seed:${args.email}`,
  });

  const persisted = await persistPlaybookInsightsForUser({
    runId,
    userId: args.userId,
    evaluation,
  });

  if (persisted.createdInsights.length > 0) {
    try {
      await deliverPlaybookInsightsToSlack({
        userId: args.userId,
        createdInsights: persisted.createdInsights,
        deliverSlackByPlaybookRuleId: alertConfig.deliverSlackByPlaybookRuleId,
      });
    } catch (slackError) {
      console.error(
        "[playbook-insights-seed-mock] slack delivery failed",
        args.userId,
        slackError,
      );
    }
  }

  await completePlaybookInsightsRun(runId, {
    usersEvaluated: 1,
    insightsCreated: persisted.insightsCreated,
    campaignsEvaluated: campaigns.length,
    errorCount: 0,
  });

  return {
    userId: args.userId,
    email: args.email,
    runId,
    insightsCreated: persisted.insightsCreated,
    candidateCount: evaluation.candidates.length,
    scenario: "full_demo",
  };
}
