import { describe, expect, test } from "bun:test";
import { flagsForGrantedAsset } from "./meta-asset-selection-flags";

const enabled = [
  { assetKind: "ad_account" as const, assetId: "111", isPrimary: true },
  { assetKind: "identity" as const, assetId: "page-2", isPrimary: false },
];

describe("flagsForGrantedAsset", () => {
  test("marks a granted ad account as enabled and primary from the stored selection", () => {
    expect(flagsForGrantedAsset(enabled, "ad_account", "111")).toEqual({
      enabled: true,
      primary: true,
    });
  });

  test("keeps a granted identity that is not in the selection", () => {
    expect(flagsForGrantedAsset(enabled, "identity", "page-9")).toEqual({
      enabled: false,
      primary: false,
    });
  });

  test("does not treat a same id of another kind as enabled", () => {
    expect(flagsForGrantedAsset(enabled, "identity", "111")).toEqual({
      enabled: false,
      primary: false,
    });
  });
});
