import {
  hasPrimariesStep,
  validateSelection,
  withImplicitPrimaries,
  type AssetLimits,
  type GrantedAssets,
  type SelectionProposal,
} from "@/lib/meta-business/meta-asset-policy";
import type { SelectionSubmitBody } from "./meta-asset-mutation-plan";

export const ADMIN_SELECTION_STEP_IDS = [
  "ad_accounts",
  "identities",
  "primaries",
  "confirm",
] as const;

export type AdminSelectionStepId = (typeof ADMIN_SELECTION_STEP_IDS)[number];

export type SelectionDraft = {
  adAccountIds: readonly string[];
  identityPageIds: readonly string[];
  primaryAdAccountId: string | null;
  primaryIdentityPageId: string | null;
};

export function draftToProposal(draft: SelectionDraft): SelectionProposal {
  return {
    adAccounts: {
      chosenIds: draft.adAccountIds,
      primaryIds: draft.primaryAdAccountId ? [draft.primaryAdAccountId] : [],
    },
    identities: {
      chosenIds: draft.identityPageIds,
      primaryIds: draft.primaryIdentityPageId
        ? [draft.primaryIdentityPageId]
        : [],
    },
  };
}

export function visibleSelectionSteps(
  proposal: SelectionProposal,
): AdminSelectionStepId[] {
  if (hasPrimariesStep(proposal)) {
    return ["ad_accounts", "identities", "primaries", "confirm"];
  }
  return ["ad_accounts", "identities", "confirm"];
}

export function canAdvanceSelectionStep(input: {
  step: AdminSelectionStepId;
  proposal: SelectionProposal;
  granted: GrantedAssets;
  limits: AssetLimits;
}): boolean {
  switch (input.step) {
    case "ad_accounts":
      return kindCanAdvance(
        input.proposal.adAccounts.chosenIds,
        input.granted.adAccountIds,
        input.limits.adAccounts,
      );
    case "identities":
      return kindCanAdvance(
        input.proposal.identities.chosenIds,
        input.granted.identityIds,
        input.limits.identities,
      );
    case "primaries":
    case "confirm":
      return validateSelection({
        proposal: withImplicitPrimaries(input.proposal),
        granted: input.granted,
        limits: input.limits,
      }).ok;
    default: {
      const _exhaustive: never = input.step;
      return _exhaustive;
    }
  }
}

export function toggleChosenId(
  chosenIds: readonly string[],
  id: string,
  limit: number,
): { ids: string[]; overLimit: boolean } {
  if (chosenIds.includes(id)) {
    return {
      ids: chosenIds.filter((chosenId) => chosenId !== id),
      overLimit: false,
    };
  }

  if (chosenIds.length >= limit) {
    return { ids: [...chosenIds], overLimit: true };
  }

  return { ids: [...chosenIds, id], overLimit: false };
}

export function toSelectionSubmitBody(
  proposal: SelectionProposal,
): SelectionSubmitBody {
  const filled = withImplicitPrimaries(proposal);
  return {
    adAccounts: filled.adAccounts.chosenIds.map((id) => ({
      id,
      isPrimary: filled.adAccounts.primaryIds.includes(id),
    })),
    identities: filled.identities.chosenIds.map((pageId) => ({
      pageId,
      isPrimary: filled.identities.primaryIds.includes(pageId),
    })),
  };
}

function kindCanAdvance(
  chosenIds: readonly string[],
  grantedIds: readonly string[],
  limit: number,
): boolean {
  if (chosenIds.length > limit) {
    return false;
  }
  if (chosenIds.length === 0) {
    return grantedIds.length === 0;
  }
  return true;
}
