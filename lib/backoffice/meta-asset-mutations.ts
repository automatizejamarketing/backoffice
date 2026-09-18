import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { GraphApiError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { getAdvertisingIdentities } from "@/lib/meta-business/get-instagram-connected-page";
import {
  backofficeAuditLog,
  metaAssetEvent,
  metaAssetPolicy,
  metaEnabledAsset,
  user,
} from "@/lib/db/schema";
import {
  META_ASSET_DEFAULT_LIMIT,
  parseSelectionProposal,
  planMetaAssetLimitsUpdate,
  planMetaAssetSelectionRequest,
  planMetaAssetSelectionSet,
  type MetaAssetAuditWrite,
  type MetaAssetEventWrite,
  type PolicyWrite,
  type SelectionSetEnabledAsset,
  type StoredPolicySnapshot,
} from "./meta-asset-mutation-plan";

export async function updateUserMetaAssetLimitsWithAudit(input: {
  userId: string;
  adAccountLimit: unknown;
  identityLimit: unknown;
  adminEmail: string;
}) {
  const existing = await findUserId(input.userId);
  if (!existing) {
    return { ok: false as const, error: "User not found" as const };
  }

  const current = await loadPolicySnapshot(input.userId);
  const token = await getUserAccessTokenByUserId(input.userId);
  const at = new Date();
  const plan = planMetaAssetLimitsUpdate({
    userId: input.userId,
    current,
    adAccountLimit: input.adAccountLimit,
    identityLimit: input.identityLimit,
    hasActiveConnection: token.success,
    adminEmail: input.adminEmail,
    at,
  });

  if (!plan.ok) {
    return { ok: false as const, error: plan.error };
  }

  if (!plan.changed) {
    return {
      ok: true as const,
      changed: false as const,
      limits: {
        adAccounts: current?.adAccountLimit ?? META_ASSET_DEFAULT_LIMIT,
        identities: current?.identityLimit ?? META_ASSET_DEFAULT_LIMIT,
      },
    };
  }

  await persistMutation(input.userId, input.adminEmail, plan, at);
  return {
    ok: true as const,
    changed: true as const,
    limits: {
      adAccounts: plan.policy.adAccountLimit,
      identities: plan.policy.identityLimit,
    },
  };
}

export async function requestUserMetaAssetSelectionWithAudit(input: {
  userId: string;
  note?: string | null;
  adminEmail: string;
}) {
  const existing = await findUserId(input.userId);
  if (!existing) {
    return { ok: false as const, error: "User not found" as const };
  }

  const current = await loadPolicySnapshot(input.userId);
  const at = new Date();
  const plan = planMetaAssetSelectionRequest({
    userId: input.userId,
    current,
    note: input.note,
    adminEmail: input.adminEmail,
    at,
  });

  await persistMutation(input.userId, input.adminEmail, plan, at);
  return { ok: true as const };
}

export async function setUserMetaAssetSelectionWithAudit(input: {
  userId: string;
  body: unknown;
  adminEmail: string;
}) {
  const existing = await findUserId(input.userId);
  if (!existing) {
    return { ok: false as const, error: "User not found" as const };
  }

  const proposal = parseSelectionProposal(input.body);
  if (!proposal) {
    return { ok: false as const, error: "invalid_body" as const };
  }

  const live = await loadLiveGranted(input.userId);
  if (!live.ok) {
    return live;
  }

  const current = await loadPolicySnapshot(input.userId);
  const previouslyEnabled = await loadEnabledAssets(input.userId);
  const at = new Date();
  const plan = planMetaAssetSelectionSet({
    userId: input.userId,
    current,
    granted: live.granted,
    proposal,
    previouslyEnabled,
    adminEmail: input.adminEmail,
    at,
  });

  if (!plan.ok) {
    return { ok: false as const, error: plan.error };
  }

  await persistMutation(input.userId, input.adminEmail, plan, at, {
    enabled: decorateEnabled(plan.assets, live.catalog),
    clearUnavailable: true,
  });
  return { ok: true as const };
}

export async function loadPolicySnapshot(
  userId: string,
): Promise<StoredPolicySnapshot | null> {
  const [row] = await db
    .select()
    .from(metaAssetPolicy)
    .where(eq(metaAssetPolicy.userId, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    adAccountLimit: row.adAccountLimit,
    identityLimit: row.identityLimit,
    selectionStatus: row.selectionStatus,
    pendingReason: row.pendingReason ?? null,
    pendingRequestedBy: row.pendingRequestedBy ?? null,
    pendingRequestedAt: row.pendingRequestedAt ?? null,
    selectedAt: row.selectedAt ?? null,
    selectedBy: row.selectedBy ?? null,
    selectionMode: row.selectionMode ?? null,
  };
}

async function findUserId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.id ?? null;
}

async function loadEnabledAssets(
  userId: string,
): Promise<SelectionSetEnabledAsset[]> {
  const rows = await db
    .select({
      kind: metaEnabledAsset.assetKind,
      id: metaEnabledAsset.assetId,
      isPrimary: metaEnabledAsset.isPrimary,
    })
    .from(metaEnabledAsset)
    .where(eq(metaEnabledAsset.userId, userId));
  return rows;
}

type LiveCatalog = {
  adAccounts: Map<string, { name: string }>;
  identities: Map<
    string,
    {
      pageName: string;
      instagramBusinessAccountId: string;
      instagramUsername: string | null;
    }
  >;
};

async function loadLiveGranted(userId: string): Promise<
  | {
      ok: false;
      error: "never_connected" | "reconnect_required" | "lists_unavailable";
    }
  | {
      ok: true;
      granted: { adAccountIds: string[]; identityIds: string[] };
      catalog: LiveCatalog;
    }
> {
  const metaAccount = await getUserMetaBusinessAccount(userId);
  if (!metaAccount) {
    return { ok: false, error: "never_connected" };
  }

  const token = await getUserAccessTokenByUserId(userId);
  if (!token.success) {
    return { ok: false, error: "reconnect_required" };
  }

  try {
    const userWithAccounts = await getUserWithAdAccounts(token.accessToken, {
      tokenKind: token.connection.tokenKind,
      bisuAppScopedId: token.connection.bisuAppScopedId,
      clientBusinessId: token.connection.clientBusinessId,
      connectionName: token.connection.name,
    });
    const adAccounts = userWithAccounts.adaccounts?.data ?? [];
    // Same definition of "granted identity" as the app (see meta-assets-card-data.ts): a
    // selection is validated against what the client can really advertise with.
    const identities = await getAdvertisingIdentities(token.accessToken, {
      adAccountIds: adAccounts.map((account) => account.account_id),
      tokenKind: token.connection.tokenKind,
      bisuAppScopedId: token.connection.bisuAppScopedId,
    });
    const catalog: LiveCatalog = {
      adAccounts: new Map(
        adAccounts.map((account) => [
          account.account_id,
          { name: account.name ?? `Conta ${account.account_id}` },
        ]),
      ),
      identities: new Map(
        identities.map((page) => [
          page.pageId,
          {
            pageName: page.pageName ?? page.pageId,
            instagramBusinessAccountId: page.instagramBusinessAccountId,
            instagramUsername: page.instagramUsername ?? null,
          },
        ]),
      ),
    };

    return {
      ok: true,
      granted: {
        adAccountIds: [...catalog.adAccounts.keys()],
        identityIds: [...catalog.identities.keys()],
      },
      catalog,
    };
  } catch (error) {
    if (error instanceof GraphApiError && error.errorReturn.data?.code === 190) {
      return { ok: false, error: "reconnect_required" };
    }
    return { ok: false, error: "lists_unavailable" };
  }
}

function decorateEnabled(
  assets: readonly SelectionSetEnabledAsset[],
  catalog: LiveCatalog,
) {
  return assets.map((asset) => {
    if (asset.kind === "ad_account") {
      const live = catalog.adAccounts.get(asset.id);
      return {
        ...asset,
        displayName: live?.name ?? asset.id,
        instagramBusinessAccountId: null as string | null,
        instagramUsername: null as string | null,
      };
    }

    const live = catalog.identities.get(asset.id);
    return {
      ...asset,
      displayName: live?.pageName ?? asset.id,
      instagramBusinessAccountId: live?.instagramBusinessAccountId ?? null,
      instagramUsername: live?.instagramUsername ?? null,
    };
  });
}

async function persistMutation(
  userId: string,
  adminEmail: string,
  plan: {
    policy: PolicyWrite;
    audit: MetaAssetAuditWrite;
    event: MetaAssetEventWrite;
  },
  at: Date,
  options?: {
    enabled?: Array<{
      kind: SelectionSetEnabledAsset["kind"];
      id: string;
      isPrimary: boolean;
      displayName: string | null;
      instagramBusinessAccountId: string | null;
      instagramUsername: string | null;
    }>;
    clearUnavailable?: boolean;
  },
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(metaAssetPolicy)
      .values({
        userId: plan.policy.userId,
        adAccountLimit: plan.policy.adAccountLimit,
        identityLimit: plan.policy.identityLimit,
        selectionStatus: plan.policy.selectionStatus,
        pendingReason: plan.policy.pendingReason,
        pendingRequestedBy: plan.policy.pendingRequestedBy,
        pendingRequestedAt: plan.policy.pendingRequestedAt,
        selectedAt: plan.policy.selectedAt,
        selectedBy: plan.policy.selectedBy,
        selectionMode: plan.policy.selectionMode,
        unavailableAssetIds: [],
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: metaAssetPolicy.userId,
        set: {
          adAccountLimit: plan.policy.adAccountLimit,
          identityLimit: plan.policy.identityLimit,
          selectionStatus: plan.policy.selectionStatus,
          pendingReason: plan.policy.pendingReason,
          pendingRequestedBy: plan.policy.pendingRequestedBy,
          pendingRequestedAt: plan.policy.pendingRequestedAt,
          selectedAt: plan.policy.selectedAt,
          selectedBy: plan.policy.selectedBy,
          selectionMode: plan.policy.selectionMode,
          ...(options?.clearUnavailable ? { unavailableAssetIds: [] } : {}),
          updatedAt: at,
        },
      });

    if (options?.enabled) {
      await tx
        .delete(metaEnabledAsset)
        .where(eq(metaEnabledAsset.userId, userId));

      if (options.enabled.length > 0) {
        await tx.insert(metaEnabledAsset).values(
          options.enabled.map((asset) => ({
            userId,
            assetKind: asset.kind,
            assetId: asset.id,
            isPrimary: asset.isPrimary,
            displayName: asset.displayName,
            instagramBusinessAccountId: asset.instagramBusinessAccountId,
            instagramUsername: asset.instagramUsername,
          })),
        );
      }
    }

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: plan.audit.action,
      fieldName: plan.audit.fieldName,
      oldValue: plan.audit.oldValue,
      newValue: plan.audit.newValue,
      note: plan.audit.note,
    });

    await tx.insert(metaAssetEvent).values({
      userId,
      eventType: plan.event.eventType,
      actor: plan.event.actor,
      payload: plan.event.payload,
    });
  });
}
