import { inArray } from "drizzle-orm";
import { getUsersWithMetaBusinessAccount } from "@/lib/db/admin-queries";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  completePlaybookInsightsRun,
  createPlaybookInsightsRun,
  failPlaybookInsightsRun,
  persistPlaybookInsightsForUser,
} from "@/lib/db/playbook-insights-queries";
import { getConsultantPlaybookAlertConfig } from "@/lib/db/proactivity-alert-queries";
import {
  isMetaFakeScenarioUser,
  parseMetaFakeScenarioUserIds,
} from "@/lib/meta-fake/config";
import {
  buildFullDemoCampaignMetrics,
  FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
} from "@/lib/meta-fake/full-demo-campaigns";
import { GraphApiError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { PLAYBOOK_INSIGHTS_CLAIM_BATCH_SIZE } from "@/lib/playbook-insights/constants";
import { evaluatePlaybookInsights } from "@/lib/playbook-insights/evaluate";
import { fetchCampaignMetricsForAccount } from "@/lib/playbook-insights/fetch-campaign-metrics";
import { deliverPlaybookInsightsToSlack } from "@/lib/proactivity/slack-delivery";

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
  return "Unknown evaluation error";
}

export type PlaybookInsightsBatchResult = {
  runId: string;
  totalWithMeta: number;
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

/**
 * Evaluate playbook rules for users with Meta connected and persist consultant insights.
 */
export async function runPlaybookInsightsBatch(
  options: RunPlaybookInsightsBatchOptions = {},
): Promise<PlaybookInsightsBatchResult> {
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const maxUsers = options.maxUsers ?? PLAYBOOK_INSIGHTS_CLAIM_BATCH_SIZE;
  const triggeredBy = options.triggeredBy ?? "manual";

  const allUsers: Array<{ id: string; email: string }> = [];
  let page = 1;
  let totalWithMeta = 0;

  for (;;) {
    const batch = await getUsersWithMetaBusinessAccount({
      page,
      limit: pageSize,
      userIds: options.userIds,
    });
    totalWithMeta = batch.total;
    allUsers.push(
      ...batch.users.map((row) => ({ id: row.id, email: row.email })),
    );
    if (allUsers.length >= batch.total || batch.users.length === 0) break;
    page += 1;
  }

  // Explicit userIds may include fake-scenario QA users without Meta connected.
  if (options.userIds && options.userIds.length > 0) {
    const known = new Set(allUsers.map((row) => row.id));
    const missingFakeIds = options.userIds.filter(
      (id) => !known.has(id) && isMetaFakeScenarioUser(id),
    );
    if (missingFakeIds.length > 0) {
      const rows = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(inArray(user.id, missingFakeIds));
      allUsers.push(...rows);
    }
  } else {
    // Cron path: also evaluate allowlisted fake users that have no Meta row.
    const allowlist = [...parseMetaFakeScenarioUserIds()];
    if (allowlist.length > 0) {
      const known = new Set(allUsers.map((row) => row.id.toLowerCase()));
      const missing = allowlist.filter((id) => !known.has(id));
      if (missing.length > 0) {
        const rows = await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(inArray(user.id, missing));
        allUsers.push(...rows.filter((row) => isMetaFakeScenarioUser(row.id)));
      }
    }
  }

  const targets = allUsers.slice(0, maxUsers);
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

  try {
    for (const target of targets) {
      try {
        if (isMetaFakeScenarioUser(target.id)) {
          const now = new Date();
          const campaigns = buildFullDemoCampaignMetrics(now);
          const evaluation = evaluatePlaybookInsights({
            accountId: FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
            campaigns,
            now,
            config: evaluationConfig,
          });
          const persisted = await persistPlaybookInsightsForUser({
            runId,
            userId: target.id,
            evaluation,
          });

          if (persisted.createdInsights.length > 0) {
            try {
              await deliverPlaybookInsightsToSlack({
                userId: target.id,
                createdInsights: persisted.createdInsights,
                deliverSlackByPlaybookRuleId:
                  alertConfig.deliverSlackByPlaybookRuleId,
              });
            } catch (slackError) {
              console.error(
                "[playbook-insights] slack delivery failed",
                target.id,
                slackError,
              );
            }
          }

          insightsCreated += persisted.insightsCreated;
          campaignsEvaluated += campaigns.length;
          results.push({
            userId: target.id,
            email: target.email,
            insightsCreated: persisted.insightsCreated,
            campaignsEvaluated: campaigns.length,
            errorMessage: null,
          });
          continue;
        }

        const tokenResult = await getUserAccessTokenByUserId(target.id);
        if (!tokenResult.success) {
          results.push({
            userId: target.id,
            email: target.email,
            insightsCreated: 0,
            campaignsEvaluated: 0,
            errorMessage:
              tokenResult.error.message || "Cliente sem conta Meta conectada.",
          });
          errorCount += 1;
          continue;
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
          continue;
        }

        const accountId = firstAccount.id.startsWith("act_")
          ? firstAccount.id
          : `act_${firstAccount.account_id}`;

        const campaigns = await fetchCampaignMetricsForAccount({
          accessToken,
          accountId,
        });
        const evaluation = evaluatePlaybookInsights({
          accountId,
          campaigns,
          config: evaluationConfig,
          connectionCreatedAt: connection.createdAt,
        });
        const persisted = await persistPlaybookInsightsForUser({
          runId,
          userId: target.id,
          evaluation,
        });

        if (persisted.createdInsights.length > 0) {
          try {
            await deliverPlaybookInsightsToSlack({
              userId: target.id,
              createdInsights: persisted.createdInsights,
              deliverSlackByPlaybookRuleId:
                alertConfig.deliverSlackByPlaybookRuleId,
            });
          } catch (slackError) {
            console.error(
              "[playbook-insights] slack delivery failed",
              target.id,
              slackError,
            );
          }
        }

        insightsCreated += persisted.insightsCreated;
        campaignsEvaluated += campaigns.length;
        results.push({
          userId: target.id,
          email: target.email,
          insightsCreated: persisted.insightsCreated,
          campaignsEvaluated: campaigns.length,
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

    await completePlaybookInsightsRun(runId, {
      usersEvaluated: targets.length,
      insightsCreated,
      campaignsEvaluated,
      errorCount,
    });
  } catch (error) {
    await failPlaybookInsightsRun(
      runId,
      error instanceof Error ? error.message : "Playbook insights batch failed",
    );
    throw error;
  }

  return {
    runId,
    totalWithMeta,
    evaluated: targets.length,
    insightsCreated,
    campaignsEvaluated,
    errorCount,
    results,
  };
}
