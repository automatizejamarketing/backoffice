import { pickEnabledVisibleAccounts } from "@/lib/backoffice/enabled-ad-account-scope";
import {
  evaluatePerformanceDrop,
  type PerformanceDropEvaluation,
  type WindowMetrics,
} from "@/lib/performance-drop/evaluate";

type VisibleAccount = { id: string; account_id?: string; name?: string };

/**
 * Accounts the drop check reads: the client's enabled accounts the token
 * sees (principal first) when there is a selection, else every visible
 * account as before.
 */
export function pickDropAccounts<T extends VisibleAccount>(input: {
  visible: readonly T[];
  enabledIds: readonly string[];
}): T[] {
  const enabled = pickEnabledVisibleAccounts({
    visible: input.visible,
    enabledIds: input.enabledIds,
    keysOf: (account) => [account.id, account.account_id],
  });
  return enabled.length > 0 ? enabled : [...input.visible];
}

export type AccountDropInsight = {
  accountId: string;
  accountName: string | null;
  evaluation: PerformanceDropEvaluation;
  title: string;
  evidence: string;
};

/**
 * One drop per account. Summing accounts let a healthy account hide a
 * collapsing one (and added different currencies); each account now has to
 * clear the sample floors on its own. The account is named in the title when
 * there is more than one, so the consultant knows where to look.
 */
export function evaluateDropsPerAccount(
  pairs: ReadonlyArray<{
    accountId: string;
    accountName: string | null;
    previous: WindowMetrics;
    current: WindowMetrics;
  }>,
): AccountDropInsight[] {
  const multiple = pairs.length > 1;
  const drops: AccountDropInsight[] = [];
  for (const pair of pairs) {
    const evaluation = evaluatePerformanceDrop(pair.previous, pair.current);
    if (!evaluation.hasDrop) continue;
    const label = pair.accountName?.trim() || pair.accountId;
    drops.push({
      accountId: pair.accountId,
      accountName: pair.accountName,
      evaluation,
      title: multiple ? `${evaluation.title} · ${label}` : evaluation.title,
      evidence: multiple
        ? `Conta ${label}: ${evaluation.evidence}`
        : evaluation.evidence,
    });
  }
  return drops.sort(
    (a, b) => (b.evaluation.dropRatio ?? 0) - (a.evaluation.dropRatio ?? 0),
  );
}
