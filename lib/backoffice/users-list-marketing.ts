import { sql, type SQL } from "drizzle-orm";
import {
  user,
  type MetaAssetPendingReason,
  type MetaAssetSelectionStatus,
} from "@/lib/db/schema";
import type { MetaStatusFilter } from "./users-filters";

export const META_PENDING_REASON_LABELS: Record<
  MetaAssetPendingReason,
  string
> = {
  initial: "inicial",
  limit_changed: "limite alterado",
  support_requested: "pedido do suporte",
};

export type UsersListMarketingLabel =
  | "Seleção pendente"
  | "Ativo indisponível"
  | "Meta conectado"
  | "Sem Meta";

export type UsersListMarketingState = {
  label: UsersListMarketingLabel;
  tooltip: string | null;
};

export type UsersListMarketingInput = {
  hasMetaBusinessAccount: boolean;
  selectionStatus: MetaAssetSelectionStatus | null;
  pendingReason: MetaAssetPendingReason | null;
  unavailableAssetCount: number;
};

export function resolveUsersListMarketingState(
  input: UsersListMarketingInput,
): UsersListMarketingState {
  if (input.selectionStatus === "pending") {
    return {
      label: "Seleção pendente",
      tooltip:
        META_PENDING_REASON_LABELS[input.pendingReason ?? "initial"],
    };
  }

  if (input.unavailableAssetCount > 0) {
    return { label: "Ativo indisponível", tooltip: null };
  }

  return {
    label: input.hasMetaBusinessAccount ? "Meta conectado" : "Sem Meta",
    tooltip: null,
  };
}

export function resolveUsersListMarketingStateFromUser(user: {
  hasMetaBusinessAccount: boolean;
  metaSelectionStatus?: MetaAssetSelectionStatus | null;
  metaPendingReason?: MetaAssetPendingReason | null;
  unavailableMetaAssetCount?: number;
}): UsersListMarketingState {
  return resolveUsersListMarketingState({
    hasMetaBusinessAccount: user.hasMetaBusinessAccount,
    selectionStatus: user.metaSelectionStatus ?? null,
    pendingReason: user.metaPendingReason ?? null,
    unavailableAssetCount: user.unavailableMetaAssetCount ?? 0,
  });
}

export function matchesMetaStatusFilter(
  filter: MetaStatusFilter,
  input: UsersListMarketingInput,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "connected":
      return input.hasMetaBusinessAccount;
    case "disconnected":
      return !input.hasMetaBusinessAccount;
    case "selection_pending":
      return input.selectionStatus === "pending";
    case "asset_unavailable":
      return (
        input.selectionStatus !== "pending" && input.unavailableAssetCount > 0
      );
    default: {
      const exhaustiveCheck: never = filter;
      return exhaustiveCheck;
    }
  }
}

export function buildMetaStatusFilterSql(
  filter: MetaStatusFilter,
): SQL | undefined {
  switch (filter) {
    case "all":
      return undefined;
    case "connected":
      return sql`EXISTS (
        SELECT 1
        FROM meta_business_accounts mba
        WHERE mba.user_id = ${user.id}
          AND mba.deleted_at IS NULL
      )`;
    case "disconnected":
      return sql`NOT EXISTS (
        SELECT 1
        FROM meta_business_accounts mba
        WHERE mba.user_id = ${user.id}
          AND mba.deleted_at IS NULL
      )`;
    case "selection_pending":
      return sql`EXISTS (
        SELECT 1
        FROM meta_asset_policies p
        WHERE p.user_id = ${user.id}
          AND p.selection_status = 'pending'
      )`;
    case "asset_unavailable":
      return sql`EXISTS (
        SELECT 1
        FROM meta_asset_policies p
        WHERE p.user_id = ${user.id}
          AND p.selection_status IS DISTINCT FROM 'pending'
          AND jsonb_typeof(p.unavailable_asset_ids) = 'array'
          AND jsonb_array_length(p.unavailable_asset_ids) > 0
      )`;
    default: {
      const exhaustiveCheck: never = filter;
      return exhaustiveCheck;
    }
  }
}
