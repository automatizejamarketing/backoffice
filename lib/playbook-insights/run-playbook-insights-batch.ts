import { inArray } from "drizzle-orm";
import { getUsersWithMetaBusinessAccount } from "@/lib/db/admin-queries";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  claimPlaybookUsersDue,
  completePlaybookInsightsRun,
  countPlaybookUsersDue,
  createPlaybookInsightsRun,
  failPlaybookInsightsRun,
  getPlaybookUserAccess,
  persistPlaybookErrorSnapshot,
  persistPlaybookInsightsForUser,
  resolveExpiredPlaybookInsights,
} from "@/lib/db/playbook-insights-queries";
import { getConsultantPlaybookAlertConfig } from "@/lib/db/proactivity-alert-queries";
import { isMetaFakeScenarioUser } from "@/lib/meta-fake/config";
import {
  buildFullDemoCampaignMetrics,
  FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
} from "@/lib/meta-fake/full-demo-campaigns";
import { GraphApiError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import {
  PLAYBOOK_INSIGHTS_CLAIM_BATCH_SIZE,
  PLAYBOOK_INSIGHTS_SOFT_DEADLINE_MS,
  PLAYBOOK_RULE_ROAS_DECLINE,
} from "@/lib/playbook-insights/constants";
import {
  evaluatePlaybookInsights,
  isPlaybookAccessActive,
  playbookRoasDeclineLookbackDays,
  type PlaybookEvaluationConfig,
} from "@/lib/playbook-insights/evaluate";
import { fetchCampaignMetricsForAccount } from "@/lib/playbook-insights/fetch-campaign-metrics";
import { loadReadyCreativeDiagnosesForUser } from "@/lib/playbook-insights/load-creative-diagnoses";
import { deliverPlaybookInsightsToSlack } from "@/lib/proactivity/slack-delivery";

type AlertConfig = Awaited<ReturnType<typeof getConsultantPlaybookAlertConfig>>;

function formatBatchError(error: unknown): string {
  if (error instanceof GraphApiError) {
    const graphMessage = error.errorReturn.data?.message;
    const code = error.errorReturn.data?.code;
    const parts = [error.message];
    if (graphMessage && graphMessage !== error.message) {
      parts.push(graphMessage);
    }
    if (code !== undefined) {
      parts.push(`code=${code}`);
    }
    return parts.join(" | ");
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown evaluation error";
}

export type PlaybookInsightsBatchResult = {
  runId: string;
  totalWithMeta: number;
  queueDue: number;
  remainingDue: number;
  expiredResolved: number;
  evaluated: number;
  insightsCreated: number;
  campaignsEvaluated: number;
  errorCount: number;
  results: Array<{
    userId: string;
    email: string;
    insightsCreated: number;
    campaignsEvaluated: number;
    errorMessage: string | null;
  }>;
};

export type RunPlaybookInsightsBatchOptions = {
  triggeredBy?: "manual" | "cron" | "script";
  requestedByEmail?: string | null;
  pageSize?: number;
  /** Cap users per invocation (cron-friendly). */
  maxUsers?: number;
  userIds?: string[];
};

type Target = { id: string; email: string };

async function loadExplicitTargets(args: {
  userIds: string[];
  pageSize: number;
}): Promise<{ users: Target[]; totalWithMeta: number }> {
  const allUsers: Target[] = [];
  let page = 1;
  let totalWithMeta = 0;

  for (;;) {
    const batch = await getUsersWithMetaBusinessAccount({
      page,
      limit: args.pageSize,
      userIds: args.userIds,
    });
    totalWithMeta = batch.total;
    allUsers.push(
      ...batch.users.map((row) => ({ id: row.id, email: row.email })),
    );
    if (allUsers.length >= batch.total || batch.users.length === 0) break;
    page += 1;
  }

  const known = new Set(allUsers.map((row) => row.id));
  const missingFakeIds = args.userIds.filter(
    (id) => !known.has(id) && isMetaFakeScenarioUser(id),
  );
  if (missingFakeIds.length > 0) {
    const rows = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, missingFakeIds));
    allUsers.push(...rows);
  }

  return { users: allUsers, totalWithMeta };
}

async function loadCronTargets(maxUsers: number): Promise<{
  users: Target[];
  queueDue: number;
}> {
  const queueDue = await countPlaybookUsersDue();
  const claimed = await claimPlaybookUsersDue(maxUsers);
  return { users: claimed, queueDue };
}

/**
 * Evaluate playbook rules for users with Meta connected and persist consultant insights.
 * Cron path claims a stale slice of *active* accounts; later shots the same
 * day drain whoever is still due. Explicit `userIds` still force a replay.
 */
export async function runPlaybookInsightsBatch(
  options: RunPlaybookInsightsBatchOptions = {},
): Promise<PlaybookInsightsBatchResult> {
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const maxUsers = options.maxUsers ?? PLAYBOOK_INSIGHTS_CLAIM_BATCH_SIZE;
  const triggeredBy = options.triggeredBy ?? "manual";
  const targeted = Boolean(options.userIds && options.userIds.length > 0);

  const expiredResolved = await resolveExpiredPlaybookInsights();

  let totalWithMeta = 0;
  let queueDue = 0;
  let eligibleUsers: Target[] = [];
  let inactiveTargets: Target[] = [];

  if (targeted && options.userIds) {
    const loaded = await loadExplicitTargets({
      userIds: options.userIds,
      pageSize,
    });
    totalWithMeta = loaded.totalWithMeta;
    const accessByUser = await getPlaybookUserAccess(
      loaded.users.map((row) => row.id),
    );
    for (const row of loaded.users) {
      if (isMetaFakeScenarioUser(row.id)) {
        eligibleUsers.push(row);
        continue;
      }
      const access = accessByUser.get(row.id);
      if (isPlaybookAccessActive({ expirationDate: access?.expirationDate })) {
        eligibleUsers.push(row);
      } else {
        inactiveTargets.push(row);
      }
    }
    eligibleUsers = eligibleUsers.slice(0, maxUsers);
    inactiveTargets = inactiveTargets.slice(0, maxUsers);
    queueDue = eligibleUsers.length;
  } else {
    const loaded = await loadCronTargets(maxUsers);
    eligibleUsers = loaded.users;
    queueDue = loaded.queueDue;
    totalWithMeta = queueDue;
  }

  const runId = await createPlaybookInsightsRun({
    triggeredBy,
    requestedByEmail: options.requestedByEmail ?? null,
  });

  const alertConfig = await getConsultantPlaybookAlertConfig();
  const evaluationConfig = {
    enabledRuleIds: alertConfig.enabledPlaybookRuleIds,
    thresholdsByRuleId: alertConfig.thresholdsByPlaybookRuleId,
  };

  const results: PlaybookInsightsBatchResult["results"] = [];
  let insightsCreated = 0;
  let campaignsEvaluated = 0;
  let errorCount = 0;
  const deadlineAt = Date.now() + PLAYBOOK_INSIGHTS_SOFT_DEADLINE_MS;

  try {
    for (const target of inactiveTargets) {
      try {
        const empty = evaluatePlaybookInsights({
          accountId: null,
          campaigns: [],
          config: evaluationConfig,
        });
        await persistPlaybookInsightsForUser({
          runId,
          userId: target.id,
          evaluation: empty,
        });
        results.push({
          userId: target.id,
          email: target.email,
          insightsCreated: 0,
          campaignsEvaluated: 0,
          errorMessage: null,
        });
      } catch (error) {
        errorCount += 1;
        results.push({
          userId: target.id,
          email: target.email,
          insightsCreated: 0,
          campaignsEvaluated: 0,
          errorMessage: formatBatchError(error),
        });
      }
    }

    for (const target of eligibleUsers) {
      if (Date.now() >= deadlineAt) {
        console.warn(
          "[playbook-insights] soft deadline reached, remaining users stay in queue",
          { evaluated: results.length, claimed: eligibleUsers.length },
        );
        break;
      }

      const outcome = await evaluatePlaybookTarget({
        target,
        runId,
        evaluationConfig,
        alertConfig,
      });
      results.push(outcome.row);
      insightsCreated += outcome.insightsCreated;
      campaignsEvaluated += outcome.campaignsEvaluated;
      if (outcome.row.errorMessage) errorCount += 1;
    }

    const remainingDue = targeted ? 0 : await countPlaybookUsersDue();

    await completePlaybookInsightsRun(runId, {
      usersEvaluated: results.length,
      insightsCreated,
      campaignsEvaluated,
      errorCount,
    });

    return {
      runId,
      totalWithMeta,
      queueDue,
      remainingDue,
      expiredResolved,
      evaluated: results.length,
      insightsCreated,
      campaignsEvaluated,
      errorCount,
      results,
    };
  } catch (error) {
    await failPlaybookInsightsRun(
      runId,
      error instanceof Error ? error.message : "Playbook insights batch failed",
    );
    throw error;
  }
}

async function evaluatePlaybookTarget(args: {
  target: Target;
  runId: string;
  evaluationConfig: PlaybookEvaluationConfig;
  alertConfig: AlertConfig;
}): Promise<{
  row: PlaybookInsightsBatchResult["results"][number];
  insightsCreated: number;
  campaignsEvaluated: number;
}> {
  const { target, runId, evaluationConfig, alertConfig } = args;

  const fail = async (error: unknown) => {
    const errorMessage = formatBatchError(error);
    try {
      await persistPlaybookErrorSnapshot({
        runId,
        userId: target.id,
        errorMessage,
      });
    } catch (persistError) {
      console.error(
        "[playbook-insights] failed to persist error snapshot",
        target.id,
        persistError,
      );
    }
    return {
      row: {
        userId: target.id,
        email: target.email,
        insightsCreated: 0,
        campaignsEvaluated: 0,
        errorMessage,
      },
      insightsCreated: 0,
      campaignsEvaluated: 0,
    };
  };

  try {
    const creativeDiagnoses = await loadReadyCreativeDiagnosesForUser(
      target.id,
    );

    if (isMetaFakeScenarioUser(target.id)) {
      const now = new Date();
      const campaigns = buildFullDemoCampaignMetrics(now);
      const evaluation = evaluatePlaybookInsights({
        accountId: FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
        campaigns,
        now,
        config: evaluationConfig,
        creativeDiagnoses,
      });
      const persisted = await persistPlaybookInsightsForUser({
        runId,
        userId: target.id,
        evaluation,
      });
      await maybeDeliverSlack({
        userId: target.id,
        createdInsights: persisted.createdInsights,
        alertConfig,
      });
      return {
        row: {
          userId: target.id,
          email: target.email,
          insightsCreated: persisted.insightsCreated,
          campaignsEvaluated: campaigns.length,
          errorMessage: null,
        },
        insightsCreated: persisted.insightsCreated,
        campaignsEvaluated: campaigns.length,
      };
    }

    const tokenResult = await getUserAccessTokenByUserId(target.id);
    if (!tokenResult.success) {
      return fail(
        tokenResult.error.message || "Cliente sem conta Meta conectada.",
      );
    }

    const { accessToken, connection } = tokenResult;
    const profile = await getUserWithAdAccounts(accessToken, {
      tokenKind: connection.tokenKind,
      bisuAppScopedId: connection.bisuAppScopedId,
      clientBusinessId: connection.clientBusinessId,
      connectionName: connection.name,
    });
    const firstAccount = profile.adaccounts?.data?.[0];
    if (!firstAccount) {
      const empty = evaluatePlaybookInsights({
        accountId: null,
        campaigns: [],
        config: evaluationConfig,
        creativeDiagnoses,
      });
      const persisted = await persistPlaybookInsightsForUser({
        runId,
        userId: target.id,
        evaluation: empty,
      });
      return {
        row: {
          userId: target.id,
          email: target.email,
          insightsCreated: persisted.insightsCreated,
          campaignsEvaluated: 0,
          errorMessage: null,
        },
        insightsCreated: persisted.insightsCreated,
        campaignsEvaluated: 0,
      };
    }

    const accountId = firstAccount.id.startsWith("act_")
      ? firstAccount.id
      : `act_${firstAccount.account_id}`;

    const campaigns = await fetchCampaignMetricsForAccount({
      accessToken,
      accountId,
      lookbackDays: evaluationConfig.enabledRuleIds?.has(
        PLAYBOOK_RULE_ROAS_DECLINE,
      )
        ? playbookRoasDeclineLookbackDays(evaluationConfig)
        : undefined,
    });
    const evaluation = evaluatePlaybookInsights({
      accountId,
      campaigns,
      config: evaluationConfig,
      connectionCreatedAt: connection.createdAt,
      creativeDiagnoses,
    });
    const persisted = await persistPlaybookInsightsForUser({
      runId,
      userId: target.id,
      evaluation,
    });
    await maybeDeliverSlack({
      userId: target.id,
      createdInsights: persisted.createdInsights,
      alertConfig,
    });
    return {
      row: {
        userId: target.id,
        email: target.email,
        insightsCreated: persisted.insightsCreated,
        campaignsEvaluated: campaigns.length,
        errorMessage: null,
      },
      insightsCreated: persisted.insightsCreated,
      campaignsEvaluated: campaigns.length,
    };
  } catch (error) {
    return fail(error);
  }
}

async function maybeDeliverSlack(args: {
  userId: string;
  createdInsights: Awaited<
    ReturnType<typeof persistPlaybookInsightsForUser>
  >["createdInsights"];
  alertConfig: AlertConfig;
}): Promise<void> {
  if (args.createdInsights.length === 0) return;
  try {
    await deliverPlaybookInsightsToSlack({
      userId: args.userId,
      createdInsights: args.createdInsights,
      deliverSlackByPlaybookRuleId: args.alertConfig.deliverSlackByPlaybookRuleId,
    });
  } catch (slackError) {
    console.error(
      "[playbook-insights] slack delivery failed",
      args.userId,
      slackError,
    );
  }
}
