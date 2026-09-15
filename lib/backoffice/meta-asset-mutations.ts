import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  backofficeAuditLog,
  metaAssetEvent,
  metaAssetPolicy,
  user,
} from "@/lib/db/schema";
import {
  planMetaAssetLimitsUpdate,
  planMetaAssetSelectionRequest,
  type PolicyWrite,
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
  const metaAccount = await getUserMetaBusinessAccount(input.userId);
  const at = new Date();
  const plan = planMetaAssetLimitsUpdate({
    userId: input.userId,
    current,
    adAccountLimit: input.adAccountLimit,
    identityLimit: input.identityLimit,
    hasActiveConnection: Boolean(metaAccount),
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
        adAccounts: current?.adAccountLimit ?? 1,
        identities: current?.identityLimit ?? 1,
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

async function persistMutation(
  userId: string,
  adminEmail: string,
  plan: {
    policy: PolicyWrite;
    audit: {
      action: "update_meta_asset_limits" | "request_meta_asset_selection";
      fieldName: "meta_asset_limits" | "meta_asset_selection";
      oldValue: string | null;
      newValue: string;
      note: string | null;
    };
    event: {
      eventType: "limits_updated" | "selection_requested";
      actor: string;
      payload: Record<string, unknown>;
    };
  },
  at: Date,
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
          updatedAt: at,
        },
      });

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
