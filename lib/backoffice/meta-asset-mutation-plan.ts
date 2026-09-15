export type MetaAssetPendingReason =
  | "initial"
  | "limit_changed"
  | "support_requested";

export type StoredPolicySnapshot = {
  adAccountLimit: number;
  identityLimit: number;
  selectionStatus: "pending" | "fixed";
  pendingReason: MetaAssetPendingReason | null;
  pendingRequestedBy: string | null;
  pendingRequestedAt: Date | null;
  selectedAt: Date | null;
  selectedBy: string | null;
  selectionMode: "explicit" | "implicit" | null;
};

export type PolicyWrite = StoredPolicySnapshot & {
  userId: string;
};

export type MetaAssetAuditWrite = {
  action: "update_meta_asset_limits" | "request_meta_asset_selection";
  fieldName: "meta_asset_limits" | "meta_asset_selection";
  oldValue: string | null;
  newValue: string;
  note: string | null;
};

export type MetaAssetEventWrite = {
  eventType: "limits_updated" | "selection_requested";
  actor: string;
  payload: Record<string, unknown>;
};

export type LimitsUpdatePlan =
  | { ok: false; error: "invalid_limits" }
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      policy: PolicyWrite;
      audit: MetaAssetAuditWrite;
      event: MetaAssetEventWrite;
    };

export const META_ASSET_DEFAULT_LIMIT = 1;

export function planMetaAssetLimitsUpdate(input: {
  userId: string;
  current: StoredPolicySnapshot | null;
  adAccountLimit: unknown;
  identityLimit: unknown;
  hasActiveConnection: boolean;
  adminEmail: string;
  at: Date;
}): LimitsUpdatePlan {
  if (!isAssetLimit(input.adAccountLimit) || !isAssetLimit(input.identityLimit)) {
    return { ok: false, error: "invalid_limits" };
  }

  const beforeAd = input.current?.adAccountLimit ?? META_ASSET_DEFAULT_LIMIT;
  const beforeIdentity = input.current?.identityLimit ?? META_ASSET_DEFAULT_LIMIT;
  if (
    beforeAd === input.adAccountLimit &&
    beforeIdentity === input.identityLimit
  ) {
    return { ok: true, changed: false };
  }

  const selection = input.hasActiveConnection
    ? {
        selectionStatus: "pending" as const,
        pendingReason: "limit_changed" as const,
        pendingRequestedBy: input.adminEmail,
        pendingRequestedAt: input.at,
      }
    : {
        selectionStatus: input.current?.selectionStatus ?? "pending",
        pendingReason: input.current ? input.current.pendingReason : "initial",
        pendingRequestedBy: input.current?.pendingRequestedBy ?? null,
        pendingRequestedAt: input.current
          ? input.current.pendingRequestedAt
          : input.at,
      };

  return {
    ok: true,
    changed: true,
    policy: {
      userId: input.userId,
      adAccountLimit: input.adAccountLimit,
      identityLimit: input.identityLimit,
      ...selection,
      selectedAt: input.current?.selectedAt ?? null,
      selectedBy: input.current?.selectedBy ?? null,
      selectionMode: input.current?.selectionMode ?? null,
    },
    audit: {
      action: "update_meta_asset_limits",
      fieldName: "meta_asset_limits",
      oldValue: formatLimitsValue(beforeAd, beforeIdentity),
      newValue: formatLimitsValue(input.adAccountLimit, input.identityLimit),
      note: null,
    },
    event: {
      eventType: "limits_updated",
      actor: input.adminEmail,
      payload: {
        before: { adAccounts: beforeAd, identities: beforeIdentity },
        after: {
          adAccounts: input.adAccountLimit,
          identities: input.identityLimit,
        },
      },
    },
  };
}

export type SelectionRequestPlan = {
  ok: true;
  policy: PolicyWrite;
  audit: MetaAssetAuditWrite;
  event: MetaAssetEventWrite;
};

export function planMetaAssetSelectionRequest(input: {
  userId: string;
  current: StoredPolicySnapshot | null;
  note: string | null | undefined;
  adminEmail: string;
  at: Date;
}): SelectionRequestPlan {
  const note = normalizeNote(input.note);

  return {
    ok: true,
    policy: {
      userId: input.userId,
      adAccountLimit: input.current?.adAccountLimit ?? META_ASSET_DEFAULT_LIMIT,
      identityLimit: input.current?.identityLimit ?? META_ASSET_DEFAULT_LIMIT,
      selectionStatus: "pending",
      pendingReason: "support_requested",
      pendingRequestedBy: input.adminEmail,
      pendingRequestedAt: input.at,
      selectedAt: input.current?.selectedAt ?? null,
      selectedBy: input.current?.selectedBy ?? null,
      selectionMode: input.current?.selectionMode ?? null,
    },
    audit: {
      action: "request_meta_asset_selection",
      fieldName: "meta_asset_selection",
      oldValue: input.current?.selectionStatus ?? null,
      newValue: "pending",
      note,
    },
    event: {
      eventType: "selection_requested",
      actor: input.adminEmail,
      payload: {
        reason: "support_requested",
        note,
      },
    },
  };
}

function normalizeNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatLimitsValue(
  adAccountLimit: number,
  identityLimit: number,
): string {
  return `${adAccountLimit}/${identityLimit}`;
}

function isAssetLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 50
  );
}
