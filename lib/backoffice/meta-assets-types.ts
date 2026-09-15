import type { AdAccountsErrorResponse } from "@/app/api/users/[id]/ad-accounts/route";
import type { MetaAssetPendingReason } from "./meta-asset-mutation-plan";

export type MetaAssetsConnection =
  | { status: "never_connected" }
  | {
      status: "reconnect_required";
      error: AdAccountsErrorResponse;
    }
  | { status: "active"; listsError?: string };

export type MetaAssetsSelectionView = {
  status: "none" | "pending" | "fixed";
  reason: MetaAssetPendingReason | null;
  requestedNote: string | null;
  since: string | null;
  selectedBy: string | null;
  mode: "explicit" | "implicit" | null;
};

export type MetaAssetsGrantedAdAccount = {
  id: string;
  name: string;
  statusLabel: string | null;
  enabled: boolean;
  primary: boolean;
};

export type MetaAssetsGrantedIdentity = {
  pageId: string;
  pageName: string;
  instagramUsername: string | null;
  pagePictureUrl: string | null;
  enabled: boolean;
  primary: boolean;
};

export type MetaAssetsEnabledItem = {
  id: string;
  name: string | null;
  primary: boolean;
  available: boolean;
  instagramUsername?: string | null;
};

export type MetaAssetsResponse = {
  canEdit: boolean;
  limits: { adAccounts: number; identities: number };
  connection: MetaAssetsConnection;
  selection: MetaAssetsSelectionView;
  granted: {
    adAccounts: MetaAssetsGrantedAdAccount[];
    identities: MetaAssetsGrantedIdentity[];
  } | null;
  enabled: {
    adAccounts: MetaAssetsEnabledItem[];
    identities: MetaAssetsEnabledItem[];
  } | null;
};
