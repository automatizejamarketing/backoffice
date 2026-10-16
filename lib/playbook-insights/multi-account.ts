import { pickEnabledVisibleAccounts } from "@/lib/backoffice/enabled-ad-account-scope";
import type { PlaybookEvaluationResult } from "./types";

/** More than this and one client would eat the batch's Graph budget. */
export const PLAYBOOK_MAX_ACCOUNTS_PER_USER = 5;

export type PlaybookAccount = {
  /** `act_` prefixed. */
  accountId: string;
  name: string | null;
};

type VisibleAccount = { id: string; account_id?: string; name?: string };

function toPlaybookAccount(account: VisibleAccount): PlaybookAccount {
  return {
    accountId: account.id.startsWith("act_")
      ? account.id
      : `act_${account.account_id ?? account.id}`,
    name: account.name?.trim() || null,
  };
}

/**
 * Accounts the playbook evaluates: every account the client enabled that the
 * token still sees, principal first. With no selection (or none of it
 * visible) it keeps the old single-account behaviour: the first account Meta
 * lists.
 */
export function pickPlaybookAccounts(input: {
  visible: readonly VisibleAccount[];
  enabledIds: readonly string[];
}): PlaybookAccount[] {
  const enabled = pickEnabledVisibleAccounts({
    visible: input.visible,
    enabledIds: input.enabledIds,
    keysOf: (account) => [account.id, account.account_id],
  });
  if (enabled.length > 0) {
    return enabled.slice(0, PLAYBOOK_MAX_ACCOUNTS_PER_USER).map(toPlaybookAccount);
  }
  const first = input.visible[0];
  return first ? [toPlaybookAccount(first)] : [];
}

/**
 * Stamp each candidate with the account its campaign lives in
 * (`metrics.accountId` feeds the dashboard's Marketing link). With more than
 * one account the evidence also names it, so Slack and the dashboard say
 * which account the suggestion is about.
 */
export function labelCandidatesByAccount(input: {
  evaluation: PlaybookEvaluationResult;
  accountByCampaignId: ReadonlyMap<string, PlaybookAccount>;
  multipleAccounts: boolean;
}): PlaybookEvaluationResult {
  const candidates = input.evaluation.candidates.map((candidate) => {
    const campaignId =
      candidate.entityLevel === "campaign"
        ? candidate.entityId
        : typeof candidate.metrics.campaignId === "string"
          ? candidate.metrics.campaignId
          : null;
    const account = campaignId
      ? input.accountByCampaignId.get(campaignId)
      : undefined;
    if (!account) return candidate;
    const label = account.name ?? account.accountId;
    return {
      ...candidate,
      evidence: input.multipleAccounts
        ? `${candidate.evidence} Conta: ${label}.`
        : candidate.evidence,
      metrics: {
        ...candidate.metrics,
        accountId: account.accountId,
        accountName: account.name,
      },
    };
  });
  return { ...input.evaluation, candidates };
}
