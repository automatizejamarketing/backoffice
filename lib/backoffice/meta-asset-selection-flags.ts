import { parseAdvertisingIdentityId } from "@/lib/meta-business/advertising-identity-key";
import type { MetaAssetKind } from "@/lib/db/schema";

export type EnabledAssetFlagRow = {
  assetKind: MetaAssetKind;
  assetId: string;
  isPrimary: boolean;
  instagramBusinessAccountId?: string | null;
};

export type GrantedAssetSelectionFlags = {
  enabled: boolean;
  primary: boolean;
};

export function flagsForGrantedAsset(
  enabled: readonly EnabledAssetFlagRow[],
  kind: MetaAssetKind,
  assetId: string,
): GrantedAssetSelectionFlags {
  const pair = kind === "identity" ? parseAdvertisingIdentityId(assetId) : null;
  const match = enabled.find(row => row.assetKind === kind && (row.assetId === assetId || (pair && row.assetId === pair.pageId && row.instagramBusinessAccountId === pair.instagramBusinessAccountId)));
  return {
    enabled: Boolean(match),
    primary: match?.isPrimary ?? false,
  };
}
