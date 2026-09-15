import {
  validateSelection,
  withImplicitPrimaries,
  type GrantedAssets,
  type MetaAssetKind,
  type MetaAssetValidationCode,
  type SelectionProposal,
} from "@/lib/meta-business/meta-asset-policy";

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
  action:
    | "update_meta_asset_limits"
    | "request_meta_asset_selection"
    | "set_meta_asset_selection";
  fieldName: "meta_asset_limits" | "meta_asset_selection";
  oldValue: string | null;
  newValue: string;
  note: string | null;
};

export type MetaAssetEventWrite = {
  eventType: "limits_updated" | "selection_requested" | "selection_set_by_admin";
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

export type SelectionSetEnabledAsset = {
  kind: MetaAssetKind;
  id: string;
  isPrimary: boolean;
};

export type SelectionSetPlan =
  | { ok: false; error: MetaAssetValidationCode }
  | {
      ok: true;
      policy: PolicyWrite;
      audit: MetaAssetAuditWrite;
      event: MetaAssetEventWrite;
      assets: SelectionSetEnabledAsset[];
    };

export const META_ASSET_SELECTION_ERROR_COPY: Record<
  MetaAssetValidationCode,
  { message: string; solution: string }
> = {
  not_granted: {
    message:
      "Um dos ativos escolhidos não foi concedido pela conexão Meta atual.",
    solution:
      "Escolha apenas contas e identidades que aparecem na lista concedida.",
  },
  over_limit: {
    message: "A escolha ultrapassa o limite de ativos deste tipo.",
    solution:
      "Desmarque itens até caber no limite ou peça ao suporte para aumentá-lo.",
  },
  empty_kind: {
    message: "É preciso escolher pelo menos um ativo neste tipo.",
    solution:
      "Marque uma conta de anúncios ou uma identidade entre as concedidas.",
  },
  missing_primary: {
    message: "Falta marcar o ativo principal deste tipo.",
    solution: "Indique qual conta ou identidade é a principal.",
  },
  multiple_primary: {
    message: "Só pode haver um ativo principal por tipo.",
    solution: "Deixe um único principal em contas e um único em identidades.",
  },
  primary_not_chosen: {
    message: "O ativo principal precisa estar entre os escolhidos.",
    solution: "Marque o principal também na lista de habilitados.",
  },
};

export function metaAssetSelectionErrorCopy(
  code: MetaAssetValidationCode,
): { message: string; solution: string } {
  return META_ASSET_SELECTION_ERROR_COPY[code];
}

const SELECTION_SET_IO_ERROR_COPY = {
  invalid_body: {
    message: "O corpo da seleção está incompleto ou em formato inválido.",
    solution: "Envie contas e identidades com id e isPrimary.",
  },
  reconnect_required: {
    message: "A conexão Meta deste usuário está inválida.",
    solution: "Peça a reconexão da Meta antes de definir a seleção.",
  },
  never_connected: {
    message: "Este usuário ainda não conectou a Meta.",
    solution: "Peça a conexão da Meta antes de definir a seleção.",
  },
  lists_unavailable: {
    message: "Não foi possível carregar os ativos concedidos agora.",
    solution: "Tente de novo em instantes.",
  },
} as const;

export function selectionSetErrorCopy(code: string): {
  error: string;
  message: string;
  solution: string;
} | null {
  if (code in META_ASSET_SELECTION_ERROR_COPY) {
    const copy =
      META_ASSET_SELECTION_ERROR_COPY[code as MetaAssetValidationCode];
    return { error: code, ...copy };
  }
  if (code in SELECTION_SET_IO_ERROR_COPY) {
    const copy =
      SELECTION_SET_IO_ERROR_COPY[code as keyof typeof SELECTION_SET_IO_ERROR_COPY];
    return { error: code, ...copy };
  }
  return null;
}

export function planMetaAssetSelectionSet(input: {
  userId: string;
  current: StoredPolicySnapshot | null;
  granted: GrantedAssets;
  proposal: SelectionProposal;
  previouslyEnabled?: readonly SelectionSetEnabledAsset[];
  adminEmail: string;
  at: Date;
}): SelectionSetPlan {
  const limits = {
    adAccounts: input.current?.adAccountLimit ?? META_ASSET_DEFAULT_LIMIT,
    identities: input.current?.identityLimit ?? META_ASSET_DEFAULT_LIMIT,
  };
  const filled = withImplicitPrimaries(input.proposal);
  const validation = validateSelection({
    proposal: filled,
    granted: input.granted,
    limits,
  });

  if (!validation.ok) {
    return { ok: false, error: validation.code };
  }

  const assets = selectionAssets(filled);
  return {
    ok: true,
    policy: {
      userId: input.userId,
      adAccountLimit: limits.adAccounts,
      identityLimit: limits.identities,
      selectionStatus: "fixed",
      pendingReason: null,
      pendingRequestedBy: null,
      pendingRequestedAt: null,
      selectedAt: input.at,
      selectedBy: input.adminEmail,
      selectionMode: "explicit",
    },
    audit: {
      action: "set_meta_asset_selection",
      fieldName: "meta_asset_selection",
      oldValue: input.previouslyEnabled
        ? formatSelectionAuditValue(input.previouslyEnabled)
        : (input.current?.selectionStatus ?? null),
      newValue: formatSelectionAuditValue(assets),
      note: null,
    },
    event: {
      eventType: "selection_set_by_admin",
      actor: input.adminEmail,
      payload: {
        adAccounts: filled.adAccounts,
        identities: filled.identities,
        selectionMode: "explicit",
      },
    },
    assets,
  };
}

export function formatSelectionAuditValue(
  assets: readonly SelectionSetEnabledAsset[],
): string {
  const accounts = assets.filter((asset) => asset.kind === "ad_account");
  const identities = assets.filter((asset) => asset.kind === "identity");
  return `contas ${formatKindAuditIds(accounts)} · identidades ${formatKindAuditIds(identities)}`;
}

function selectionAssets(proposal: SelectionProposal): SelectionSetEnabledAsset[] {
  return [
    ...proposal.adAccounts.chosenIds.map((id) => ({
      kind: "ad_account" as const,
      id,
      isPrimary: proposal.adAccounts.primaryIds.includes(id),
    })),
    ...proposal.identities.chosenIds.map((id) => ({
      kind: "identity" as const,
      id,
      isPrimary: proposal.identities.primaryIds.includes(id),
    })),
  ];
}

function formatKindAuditIds(
  assets: readonly SelectionSetEnabledAsset[],
): string {
  if (assets.length === 0) {
    return "—";
  }
  return assets
    .map((asset) => (asset.isPrimary ? `${asset.id} (principal)` : asset.id))
    .join(", ");
}

export type SelectionSubmitBody = {
  adAccounts: Array<{ id: string; isPrimary: boolean }>;
  identities: Array<{ pageId: string; isPrimary: boolean }>;
};

export function parseSelectionProposal(
  value: unknown,
): SelectionProposal | null {
  if (!isSelectionSubmitBody(value)) {
    return null;
  }

  return {
    adAccounts: kindFromChosen(value.adAccounts),
    identities: kindFromChosen(
      value.identities.map((item) => ({
        id: item.pageId,
        isPrimary: item.isPrimary,
      })),
    ),
  };
}

function kindFromChosen(
  items: readonly { id: string; isPrimary: boolean }[],
): { chosenIds: string[]; primaryIds: string[] } {
  const chosenIds: string[] = [];
  const primaryIds: string[] = [];
  for (const item of items) {
    chosenIds.push(item.id);
    if (item.isPrimary) {
      primaryIds.push(item.id);
    }
  }
  return { chosenIds, primaryIds };
}

function isSelectionSubmitBody(value: unknown): value is SelectionSubmitBody {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (!("adAccounts" in value) || !("identities" in value)) {
    return false;
  }
  if (!Array.isArray(value.adAccounts) || !Array.isArray(value.identities)) {
    return false;
  }
  return (
    value.adAccounts.every(isChosenAccount) &&
    value.identities.every(isChosenIdentity)
  );
}

function isChosenAccount(
  value: unknown,
): value is SelectionSubmitBody["adAccounts"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (!("id" in value) || !("isPrimary" in value)) {
    return false;
  }
  return typeof value.id === "string" && typeof value.isPrimary === "boolean";
}

function isChosenIdentity(
  value: unknown,
): value is SelectionSubmitBody["identities"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (!("pageId" in value) || !("isPrimary" in value)) {
    return false;
  }
  return (
    typeof value.pageId === "string" && typeof value.isPrimary === "boolean"
  );
}
