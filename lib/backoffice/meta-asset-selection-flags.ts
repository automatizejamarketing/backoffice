import type { MetaAssetKind } from "@/lib/db/schema";

export type EnabledAssetFlagRow = {
  assetKind: MetaAssetKind;
  assetId: string;
  isPrimary: boolean;
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
  const match = enabled.find(
    (row) => row.assetKind === kind && row.assetId === assetId,
  );
  return {
    enabled: Boolean(match),
    primary: match?.isPrimary ?? false,
  };
}
