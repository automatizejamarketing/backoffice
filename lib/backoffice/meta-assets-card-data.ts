import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  metaAssetEvent,
  metaEnabledAsset,
} from "@/lib/db/schema";
import { GraphApiError, graphErrorToClientError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { getPagesWithInstagram } from "@/lib/meta-business/marketing/build-ad-from-media";
import { assetAvailability } from "@/lib/meta-business/meta-asset-policy";
import { buildReconnectInfo } from "@/lib/meta-business/reconnect-link";
import { META_ASSET_DEFAULT_LIMIT } from "./meta-asset-mutation-plan";
import { loadPolicySnapshot } from "./meta-asset-mutations";
import type {
  MetaAssetsEnabledItem,
  MetaAssetsResponse,
  MetaAssetsSelectionView,
} from "./meta-assets-types";

const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Não liquidada",
  7: "Revisão de risco",
  8: "Liquidação pendente",
  9: "Período de carência",
  100: "Encerramento pendente",
  101: "Encerrada",
};

export async function loadMetaAssetsCard(input: {
  userId: string;
  canEdit: boolean;
}): Promise<MetaAssetsResponse> {
  const [policy, enabledRows, requestedNote, metaAccount] = await Promise.all([
    loadPolicySnapshot(input.userId),
    db
      .select()
      .from(metaEnabledAsset)
      .where(eq(metaEnabledAsset.userId, input.userId)),
    loadRequestedNote(input.userId),
    getUserMetaBusinessAccount(input.userId),
  ]);

  const limits = {
    adAccounts: policy?.adAccountLimit ?? META_ASSET_DEFAULT_LIMIT,
    identities: policy?.identityLimit ?? META_ASSET_DEFAULT_LIMIT,
  };

  if (!metaAccount) {
    return {
      canEdit: input.canEdit,
      limits,
      connection: { status: "never_connected" },
      selection: buildMetaAssetsSelectionView(policy, requestedNote),
      granted: null,
      enabled: null,
    };
  }

  const token = await getUserAccessTokenByUserId(input.userId);
  if (!token.success) {
    return {
      canEdit: input.canEdit,
      limits,
      connection: {
        status: "reconnect_required",
        error: {
          error: token.error.error,
          message: token.error.message,
          solution: token.error.solution,
          needsReconnect: token.error.needsReconnect,
          ...(token.error.needsReconnect ? { reconnect: buildReconnectInfo() } : {}),
        },
      },
      selection: buildMetaAssetsSelectionView(policy, requestedNote),
      granted: null,
      enabled: null,
    };
  }

  try {
    const [userWithAccounts, identities] = await Promise.all([
      getUserWithAdAccounts(token.accessToken, {
        tokenKind: token.connection.tokenKind,
        bisuAppScopedId: token.connection.bisuAppScopedId,
        clientBusinessId: token.connection.clientBusinessId,
        connectionName: token.connection.name,
      }),
      getPagesWithInstagram(token.accessToken),
    ]);

    const grantedAccounts = userWithAccounts.adaccounts?.data ?? [];
    const grantedAccountIds = grantedAccounts.map((account) => account.account_id);
    const grantedIdentityIds = identities.map((page) => page.pageId);
    const enabledByKind = indexEnabled(enabledRows);

    return {
      canEdit: input.canEdit,
      limits,
      connection: { status: "active" },
      selection: buildMetaAssetsSelectionView(policy, requestedNote),
      granted: {
        adAccounts: grantedAccounts.map((account) => {
          const enabled = enabledByKind.adAccounts.get(account.account_id);
          return {
            id: account.account_id,
            name: account.name ?? `Conta ${account.account_id}`,
            statusLabel:
              account.account_status == null
                ? null
                : (ACCOUNT_STATUS_LABEL[account.account_status] ??
                  `#${account.account_status}`),
            enabled: Boolean(enabled),
            primary: enabled?.isPrimary ?? false,
          };
        }),
        identities: identities.map((page) => {
          const enabled = enabledByKind.identities.get(page.pageId);
          return {
            pageId: page.pageId,
            pageName: page.pageName ?? page.pageId,
            instagramUsername: page.instagramUsername ?? null,
            pagePictureUrl: page.pagePictureUrl ?? null,
            enabled: Boolean(enabled),
            primary: enabled?.isPrimary ?? false,
          };
        }),
      },
      enabled: {
        adAccounts: mapEnabled(
          enabledRows,
          "ad_account",
          grantedAccountIds,
        ),
        identities: mapEnabled(
          enabledRows,
          "identity",
          grantedIdentityIds,
        ),
      },
    };
  } catch (error) {
    if (error instanceof GraphApiError && error.errorReturn.data?.code === 190) {
      const client = graphErrorToClientError(error.errorReturn);
      return {
        canEdit: input.canEdit,
        limits,
        connection: {
          status: "reconnect_required",
          error: {
            ...client,
            code: 190,
            errorSubcode: error.errorReturn.data.errorSubcode,
            needsReconnect: true,
            reconnect: buildReconnectInfo(),
          },
        },
        selection: buildMetaAssetsSelectionView(policy, requestedNote),
        granted: null,
        enabled: null,
      };
    }

    return {
      canEdit: input.canEdit,
      limits,
      connection: {
        status: "active",
        listsError: "Não foi possível carregar os ativos concedidos agora.",
      },
      selection: buildMetaAssetsSelectionView(policy, requestedNote),
      granted: null,
      enabled: null,
    };
  }
}

export function buildMetaAssetsSelectionView(
  policy: Awaited<ReturnType<typeof loadPolicySnapshot>>,
  requestedNote: string | null,
): MetaAssetsSelectionView {
  if (!policy) {
    return {
      status: "none",
      reason: null,
      requestedNote: null,
      since: null,
      selectedBy: null,
      mode: null,
    };
  }

  if (policy.selectionStatus === "pending") {
    return {
      status: "pending",
      reason: policy.pendingReason ?? "initial",
      requestedNote:
        policy.pendingReason === "support_requested" ? requestedNote : null,
      since: iso(policy.pendingRequestedAt),
      selectedBy: policy.selectedBy,
      mode: policy.selectionMode,
    };
  }

  return {
    status: "fixed",
    reason: null,
    requestedNote: null,
    since: iso(policy.selectedAt),
    selectedBy: policy.selectedBy,
    mode: policy.selectionMode,
  };
}

function mapEnabled(
  rows: Array<{
    assetKind: "ad_account" | "identity";
    assetId: string;
    isPrimary: boolean;
    displayName: string | null;
    instagramUsername: string | null;
  }>,
  kind: "ad_account" | "identity",
  grantedIds: readonly string[],
): MetaAssetsEnabledItem[] {
  const items: MetaAssetsEnabledItem[] = [];
  for (const row of rows) {
    if (row.assetKind !== kind) {
      continue;
    }
    items.push({
      id: row.assetId,
      name: row.displayName,
      primary: row.isPrimary,
      available: assetAvailability(row.assetId, grantedIds) === "available",
      ...(kind === "identity"
        ? { instagramUsername: row.instagramUsername }
        : {}),
    });
  }
  return items;
}

function indexEnabled(
  rows: Array<{
    assetKind: "ad_account" | "identity";
    assetId: string;
    isPrimary: boolean;
  }>,
) {
  const adAccounts = new Map<string, { isPrimary: boolean }>();
  const identities = new Map<string, { isPrimary: boolean }>();
  for (const row of rows) {
    const target = row.assetKind === "ad_account" ? adAccounts : identities;
    target.set(row.assetId, { isPrimary: row.isPrimary });
  }
  return { adAccounts, identities };
}

async function loadRequestedNote(userId: string): Promise<string | null> {
  const rows = await db
    .select({ payload: metaAssetEvent.payload })
    .from(metaAssetEvent)
    .where(
      and(
        eq(metaAssetEvent.userId, userId),
        eq(metaAssetEvent.eventType, "selection_requested"),
      ),
    )
    .orderBy(desc(metaAssetEvent.createdAt))
    .limit(1);

  const payload = rows.at(0)?.payload;
  if (!payload || typeof payload !== "object" || !("note" in payload)) {
    return null;
  }
  return typeof payload.note === "string" ? payload.note : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
