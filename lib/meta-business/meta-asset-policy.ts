/**
 * Pure Meta-asset selection rules — no I/O, no marketing-module imports.
 *
 * The user modal, the selection route, the access resolver and the backoffice
 * "Definir seleção" dialog all call this so they cannot disagree.
 *
 * MIRRORED FILE — `automatize-frontend` and `backoffice` must hold BYTE-IDENTICAL
 * copies. After editing: `cd automatize-frontend && bun run sync:meta`.
 */

export const META_ASSET_KINDS = ["ad_account", "identity"] as const;
export type MetaAssetKind = (typeof META_ASSET_KINDS)[number];

export const META_ASSET_SELECTION_STATUSES = ["pending", "fixed"] as const;
export type MetaAssetSelectionStatus =
  (typeof META_ASSET_SELECTION_STATUSES)[number];

export const META_ASSET_PENDING_REASONS = [
  "initial",
  "limit_changed",
  "support_requested",
] as const;
export type MetaAssetPendingReason =
  (typeof META_ASSET_PENDING_REASONS)[number];

export const META_ASSET_SELECTION_MODES = ["explicit", "implicit"] as const;
export type MetaAssetSelectionMode =
  (typeof META_ASSET_SELECTION_MODES)[number];

export const META_ASSET_VALIDATION_CODES = [
  "not_granted",
  "over_limit",
  "empty_kind",
  "missing_primary",
  "multiple_primary",
  "primary_not_chosen",
] as const;
export type MetaAssetValidationCode =
  (typeof META_ASSET_VALIDATION_CODES)[number];

export type AssetAvailability = "available" | "unavailable";

export type PolicyRecord = {
  selectionStatus: MetaAssetSelectionStatus;
  pendingReason: MetaAssetPendingReason | null;
  selectionMode: MetaAssetSelectionMode | null;
};

export type DerivedSelectionState =
  | { applies: false }
  | { applies: true; status: "pending"; reason: MetaAssetPendingReason }
  | { applies: true; status: "fixed"; mode: MetaAssetSelectionMode };

export type GrantedAssets = {
  adAccountIds: readonly string[];
  identityIds: readonly string[];
};

export type AssetLimits = {
  adAccounts: number;
  identities: number;
};

export type KindSelection = {
  chosenIds: readonly string[];
  primaryIds: readonly string[];
};

export type SelectionProposal = {
  adAccounts: KindSelection;
  identities: KindSelection;
};

export type ImplicitSelection = {
  adAccounts: readonly { id: string; isPrimary: true }[];
  identities: readonly { id: string; isPrimary: true }[];
  selectedBy: "system";
  selectionMode: "implicit";
  status: "fixed";
};

export type EnabledAsset = {
  id: string;
  kind: MetaAssetKind;
  isPrimary: boolean;
};

export type SelectionValidation =
  | { ok: true }
  | { ok: false; code: MetaAssetValidationCode };

export function deriveSelectionState(input: {
  hasActiveConnection: boolean;
  policy: PolicyRecord | null;
}): DerivedSelectionState {
  if (!input.hasActiveConnection) {
    return { applies: false };
  }

  if (!input.policy) {
    return { applies: true, status: "pending", reason: "initial" };
  }

  if (input.policy.selectionStatus === "pending") {
    return {
      applies: true,
      status: "pending",
      reason: input.policy.pendingReason ?? "initial",
    };
  }

  return {
    applies: true,
    status: "fixed",
    mode: input.policy.selectionMode ?? "explicit",
  };
}

export function isImplicitSelectionApplicable(input: {
  granted: GrantedAssets;
  hasFixedSelection: boolean;
}): boolean {
  if (input.hasFixedSelection) {
    return false;
  }

  return (
    input.granted.adAccountIds.length <= 1 &&
    input.granted.identityIds.length <= 1
  );
}

export function implicitSelection(input: {
  granted: GrantedAssets;
  hasFixedSelection: boolean;
}): ImplicitSelection | null {
  if (!isImplicitSelectionApplicable(input)) {
    return null;
  }

  return {
    adAccounts: asImplicitPrimaries(input.granted.adAccountIds),
    identities: asImplicitPrimaries(input.granted.identityIds),
    selectedBy: "system",
    selectionMode: "implicit",
    status: "fixed",
  };
}

export function validateSelection(input: {
  proposal: SelectionProposal;
  granted: GrantedAssets;
  limits: AssetLimits;
}): SelectionValidation {
  const kinds = [
    {
      chosenIds: input.proposal.adAccounts.chosenIds,
      primaryIds: input.proposal.adAccounts.primaryIds,
      grantedIds: input.granted.adAccountIds,
      limit: input.limits.adAccounts,
    },
    {
      chosenIds: input.proposal.identities.chosenIds,
      primaryIds: input.proposal.identities.primaryIds,
      grantedIds: input.granted.identityIds,
      limit: input.limits.identities,
    },
  ];

  for (const code of META_ASSET_VALIDATION_CODES) {
    for (const kind of kinds) {
      if (kindViolates(code, kind)) {
        return { ok: false, code };
      }
    }
  }

  return { ok: true };
}

export function hasPrimariesStep(proposal: SelectionProposal): boolean {
  return (
    proposal.adAccounts.chosenIds.length > 1 ||
    proposal.identities.chosenIds.length > 1
  );
}

export function withImplicitPrimaries(
  proposal: SelectionProposal,
): SelectionProposal {
  return {
    adAccounts: fillSolePrimary(proposal.adAccounts),
    identities: fillSolePrimary(proposal.identities),
  };
}

export function defaultAssetId(
  enabledOfKind: readonly {
    id: string;
    isPrimary: boolean;
    available: boolean;
  }[],
): string | null {
  for (const asset of enabledOfKind) {
    if (asset.isPrimary && asset.available) {
      return asset.id;
    }
  }

  return null;
}

export function prefillSelection(input: {
  previouslyEnabled: readonly EnabledAsset[];
  granted: GrantedAssets;
  limits: AssetLimits;
}): {
  adAccountIds: string[];
  identityIds: string[];
  primaryAdAccountId: string | null;
  primaryIdentityId: string | null;
} {
  const adAccounts = prefillKind(
    input.previouslyEnabled,
    "ad_account",
    input.granted.adAccountIds,
    input.limits.adAccounts,
  );
  const identities = prefillKind(
    input.previouslyEnabled,
    "identity",
    input.granted.identityIds,
    input.limits.identities,
  );

  return {
    adAccountIds: adAccounts.ids,
    identityIds: identities.ids,
    primaryAdAccountId: adAccounts.primaryId,
    primaryIdentityId: identities.primaryId,
  };
}

export function assetAvailability(
  assetId: string,
  grantedIds: readonly string[],
): AssetAvailability {
  if (grantedIds.includes(assetId)) {
    return "available";
  }

  return "unavailable";
}

type KindView = {
  chosenIds: readonly string[];
  primaryIds: readonly string[];
  grantedIds: readonly string[];
  limit: number;
};

function kindViolates(code: MetaAssetValidationCode, kind: KindView): boolean {
  switch (code) {
    case "not_granted":
      return hasUngrantedId(kind);
    case "over_limit":
      return kind.chosenIds.length > kind.limit;
    case "empty_kind":
      return kind.chosenIds.length === 0 && kind.grantedIds.length > 0;
    case "missing_primary":
      return kind.chosenIds.length >= 1 && kind.primaryIds.length === 0;
    case "multiple_primary":
      return kind.primaryIds.length > 1;
    case "primary_not_chosen":
      return hasPrimaryOutsideChosen(kind);
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function hasUngrantedId(kind: KindView): boolean {
  const granted = new Set(kind.grantedIds);
  for (const id of kind.chosenIds) {
    if (!granted.has(id)) {
      return true;
    }
  }
  for (const id of kind.primaryIds) {
    if (!granted.has(id)) {
      return true;
    }
  }
  return false;
}

function hasPrimaryOutsideChosen(kind: KindView): boolean {
  const chosen = new Set(kind.chosenIds);
  for (const id of kind.primaryIds) {
    if (!chosen.has(id)) {
      return true;
    }
  }
  return false;
}

function asImplicitPrimaries(
  ids: readonly string[],
): { id: string; isPrimary: true }[] {
  return ids.map((id) => ({ id, isPrimary: true as const }));
}

function fillSolePrimary(kind: KindSelection): KindSelection {
  const sole = kind.chosenIds.at(0);
  if (kind.chosenIds.length !== 1 || kind.primaryIds.length > 0 || !sole) {
    return kind;
  }

  return { chosenIds: kind.chosenIds, primaryIds: [sole] };
}

function prefillKind(
  previouslyEnabled: readonly EnabledAsset[],
  kind: MetaAssetKind,
  grantedIds: readonly string[],
  limit: number,
): { ids: string[]; primaryId: string | null } {
  const granted = new Set(grantedIds);
  const stillGranted: EnabledAsset[] = [];
  for (const asset of previouslyEnabled) {
    if (asset.kind === kind && granted.has(asset.id)) {
      stillGranted.push(asset);
    }
  }

  const kept =
    stillGranted.length > limit
      ? stillGranted.filter((asset) => asset.isPrimary)
      : stillGranted;

  let primaryId: string | null = null;
  for (const asset of kept) {
    if (asset.isPrimary) {
      primaryId = asset.id;
      break;
    }
  }

  return { ids: kept.map((asset) => asset.id), primaryId };
}
