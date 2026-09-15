import { describe, expect, test } from "bun:test";
import {
  matchesMetaStatusFilter,
  resolveUsersListMarketingState,
} from "./users-list-marketing";

describe("resolveUsersListMarketingState", () => {
  test("users without a policy row keep Meta conectado or Sem Meta", () => {
    expect(
      resolveUsersListMarketingState({
        hasMetaBusinessAccount: true,
        selectionStatus: null,
        pendingReason: null,
        unavailableAssetCount: 0,
      }),
    ).toEqual({ label: "Meta conectado", tooltip: null });

    expect(
      resolveUsersListMarketingState({
        hasMetaBusinessAccount: false,
        selectionStatus: null,
        pendingReason: null,
        unavailableAssetCount: 0,
      }),
    ).toEqual({ label: "Sem Meta", tooltip: null });
  });

  test("pending policy shows Seleção pendente with the reason in the tooltip", () => {
    expect(
      resolveUsersListMarketingState({
        hasMetaBusinessAccount: true,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        unavailableAssetCount: 1,
      }),
    ).toEqual({
      label: "Seleção pendente",
      tooltip: "limite alterado",
    });

    expect(
      resolveUsersListMarketingState({
        hasMetaBusinessAccount: false,
        selectionStatus: "pending",
        pendingReason: "support_requested",
        unavailableAssetCount: 0,
      }).tooltip,
    ).toBe("pedido do suporte");
  });

  test("fixed policy with persisted unavailable assets shows Ativo indisponível", () => {
    expect(
      resolveUsersListMarketingState({
        hasMetaBusinessAccount: true,
        selectionStatus: "fixed",
        pendingReason: null,
        unavailableAssetCount: 2,
      }),
    ).toEqual({ label: "Ativo indisponível", tooltip: null });
  });
});

describe("matchesMetaStatusFilter", () => {
  const pending = {
    hasMetaBusinessAccount: true,
    selectionStatus: "pending" as const,
    pendingReason: "initial" as const,
    unavailableAssetCount: 0,
  };
  const unavailable = {
    hasMetaBusinessAccount: true,
    selectionStatus: "fixed" as const,
    pendingReason: null,
    unavailableAssetCount: 1,
  };
  const connected = {
    hasMetaBusinessAccount: true,
    selectionStatus: "fixed" as const,
    pendingReason: null,
    unavailableAssetCount: 0,
  };
  const disconnected = {
    hasMetaBusinessAccount: false,
    selectionStatus: null,
    pendingReason: null,
    unavailableAssetCount: 0,
  };

  test("selection_pending matches only a pending policy", () => {
    expect(matchesMetaStatusFilter("selection_pending", pending)).toBe(true);
    expect(matchesMetaStatusFilter("selection_pending", unavailable)).toBe(
      false,
    );
    expect(matchesMetaStatusFilter("selection_pending", connected)).toBe(false);
    expect(matchesMetaStatusFilter("selection_pending", disconnected)).toBe(
      false,
    );
  });

  test("asset_unavailable matches persisted unavailable_asset_ids, not a live Graph check", () => {
    expect(matchesMetaStatusFilter("asset_unavailable", unavailable)).toBe(
      true,
    );
    expect(matchesMetaStatusFilter("asset_unavailable", pending)).toBe(false);
    expect(matchesMetaStatusFilter("asset_unavailable", connected)).toBe(false);
  });

  test("asset_unavailable does not include a pending policy even if unavailable ids remain", () => {
    expect(
      matchesMetaStatusFilter("asset_unavailable", {
        hasMetaBusinessAccount: true,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        unavailableAssetCount: 2,
      }),
    ).toBe(false);
    expect(
      matchesMetaStatusFilter("selection_pending", {
        hasMetaBusinessAccount: true,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        unavailableAssetCount: 2,
      }),
    ).toBe(true);
  });

  test("connected and disconnected keep the Meta account existence rules", () => {
    expect(matchesMetaStatusFilter("connected", pending)).toBe(true);
    expect(matchesMetaStatusFilter("connected", disconnected)).toBe(false);
    expect(matchesMetaStatusFilter("disconnected", disconnected)).toBe(true);
    expect(matchesMetaStatusFilter("disconnected", connected)).toBe(false);
  });
});
