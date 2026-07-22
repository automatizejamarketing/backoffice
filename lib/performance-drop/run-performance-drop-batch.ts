import {
  completePerformanceDropRun,
  createPerformanceDropRun,
  failPerformanceDropRun,
  persistPerformanceDropCheckFailure,
  persistPerformanceDropForUser,
  wasPerformanceDropCheckedToday,
} from "@/lib/db/performance-drop-queries";
import {
  getUserMetaBusinessAccount,
  getUsersWithMetaBusinessAccount,
} from "@/lib/db/admin-queries";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { evaluatePerformanceDrop } from "@/lib/performance-drop/evaluate";
import {
  aggregateAccountPairs,
  fetchAccountWindowPair,
} from "@/lib/performance-drop/fetch-account-insights";

export type PerformanceDropBatchItem = {
  userId: string;
  email: string;
  checkedAccounts: number;
  hasDrop: boolean;
  severity: "warning" | "critical" | null;
  metric: "roas" | "purchases" | null;
  dropPercent: number | null;
  sampleInsufficient: boolean;
  errorMessage: string | null;
};

export type PerformanceDropBatchResult = {
  runId: string;
  totalWithMeta: number;
  eligible: number;
  evaluated: number;
  dropCount: number;
  warningCount: number;
  criticalCount: number;
  errorCount: number;
  results: PerformanceDropBatchItem[];
};

export type RunPerformanceDropBatchOptions = {
  /** Skip users already evaluated today (America/Sao_Paulo). */
  onlyStale?: boolean;
  triggeredBy?: "manual" | "cron" | "script";
  requestedByEmail?: string | null;
  pageSize?: number;
  /** Optional allow-list for testing. */
  userIds?: string[];
  onProgress?: (progress: {
    done: number;
    total: number;
    currentEmail: string;
  }) => void;
};

/**
 * For every user with Meta: fetch last_7d vs previous 7d account insights,
 * persist snapshots, and open/close drop.* insights used by /users.
 */
export async function runPerformanceDropBatch(
  options: RunPerformanceDropBatchOptions = {},
): Promise<PerformanceDropBatchResult> {
  const onlyStale = options.onlyStale ?? false;
  const pageSize = Math.max(1, options.pageSize ?? 100);
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

  const runId = await createPerformanceDropRun({
    triggeredBy,
    requestedByEmail: options.requestedByEmail ?? null,
  });

  const results: PerformanceDropBatchItem[] = [];
  let eligible = 0;
  let insightsCreated = 0;

  try {
    for (let index = 0; index < allUsers.length; index += 1) {
      const target = allUsers[index];
      options.onProgress?.({
        done: index,
        total: allUsers.length,
        currentEmail: target.email,
      });

      if (onlyStale && (await wasPerformanceDropCheckedToday(target.id))) {
        continue;
      }

      eligible += 1;

      try {
        const metaAccount = await getUserMetaBusinessAccount(target.id);
        if (!metaAccount?.accessToken) {
          results.push({
            userId: target.id,
            email: target.email,
            checkedAccounts: 0,
            hasDrop: false,
            severity: null,
            metric: null,
            dropPercent: null,
            sampleInsufficient: true,
            errorMessage: "Cliente sem conta Meta conectada.",
          });
          continue;
        }

        const userWithAdAccounts = await getUserWithAdAccounts(
          metaAccount.accessToken,
        );
        const adAccounts = userWithAdAccounts.adaccounts?.data ?? [];

        if (adAccounts.length === 0) {
          const evaluation = evaluatePerformanceDrop(
            { spend: 0, purchases: 0, purchaseValue: 0, roas: 0 },
            { spend: 0, purchases: 0, purchaseValue: 0, roas: 0 },
          );
          await persistPerformanceDropForUser({
            runId,
            userId: target.id,
            pairs: [],
            evaluation,
          });
          results.push({
            userId: target.id,
            email: target.email,
            checkedAccounts: 0,
            hasDrop: false,
            severity: null,
            metric: null,
            dropPercent: null,
            sampleInsufficient: true,
            errorMessage: null,
          });
          continue;
        }

        const pairs = [];
        for (const account of adAccounts) {
          pairs.push(
            await fetchAccountWindowPair({
              accessToken: metaAccount.accessToken,
              accountId: account.id,
              accountName: account.name ?? null,
            }),
          );
        }

        const { current, previous } = aggregateAccountPairs(pairs);
        const evaluation = evaluatePerformanceDrop(previous, current);
        const persisted = await persistPerformanceDropForUser({
          runId,
          userId: target.id,
          pairs,
          evaluation,
        });
        if (persisted.insightCreated) insightsCreated += 1;

        results.push({
          userId: target.id,
          email: target.email,
          checkedAccounts: pairs.length,
          hasDrop: evaluation.hasDrop,
          severity: evaluation.severity,
          metric: evaluation.metric,
          dropPercent: evaluation.dropPercent,
          sampleInsufficient: evaluation.sampleInsufficient,
          errorMessage: null,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Erro ao avaliar queda de performance.";

        try {
          // Mark checked today without closing open drop insights on failure.
          await persistPerformanceDropCheckFailure({
            runId,
            userId: target.id,
            errorMessage,
          });
        } catch (persistError) {
          console.error(
            "[performance-drop] failed to persist error snapshot",
            persistError,
          );
        }

        results.push({
          userId: target.id,
          email: target.email,
          checkedAccounts: 0,
          hasDrop: false,
          severity: null,
          metric: null,
          dropPercent: null,
          sampleInsufficient: false,
          errorMessage,
        });
      }
    }

    options.onProgress?.({
      done: allUsers.length,
      total: allUsers.length,
      currentEmail: "",
    });

    const dropCount = results.filter((row) => row.hasDrop).length;
    const errorCount = results.filter((row) => row.errorMessage).length;

    await completePerformanceDropRun(runId, {
      usersEvaluated: results.length,
      insightsCreated,
      dropCount,
      errorCount,
    });

    return {
      runId,
      totalWithMeta,
      eligible,
      evaluated: results.length,
      dropCount,
      warningCount: results.filter((row) => row.severity === "warning").length,
      criticalCount: results.filter((row) => row.severity === "critical")
        .length,
      errorCount,
      results,
    };
  } catch (error) {
    await failPerformanceDropRun(
      runId,
      error instanceof Error ? error.message : "Performance drop batch failed",
    );
    throw error;
  }
}
