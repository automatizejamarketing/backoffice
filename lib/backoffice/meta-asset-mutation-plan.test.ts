import { describe, expect, test } from "bun:test";
import {
  metaAssetSelectionErrorCopy,
  planMetaAssetLimitsUpdate,
  planMetaAssetSelectionRequest,
  planMetaAssetSelectionSet,
} from "./meta-asset-mutation-plan";

const NOW = new Date("2026-09-14T18:00:00.000Z");
const ADMIN = "suporte@automatize.com";
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("planMetaAssetLimitsUpdate", () => {
  test("rejects limits outside 1..50", () => {
    for (const [adAccountLimit, identityLimit] of [
      [0, 1],
      [1, 51],
      [1.5, 1],
      ["2", 1],
    ] as const) {
      expect(
        planMetaAssetLimitsUpdate({
          userId: USER_ID,
          current: null,
          adAccountLimit,
          identityLimit,
          hasActiveConnection: false,
          adminEmail: ADMIN,
          at: NOW,
        }),
      ).toEqual({ ok: false, error: "invalid_limits" });
    }
  });

  test("changing a limit with an active connection opens pending/limit_changed", () => {
    const result = planMetaAssetLimitsUpdate({
      userId: USER_ID,
      current: null,
      adAccountLimit: 2,
      identityLimit: 1,
      hasActiveConnection: true,
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      changed: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        pendingRequestedBy: ADMIN,
        pendingRequestedAt: NOW,
        selectedAt: null,
        selectedBy: null,
        selectionMode: null,
      },
      audit: {
        action: "update_meta_asset_limits",
        fieldName: "meta_asset_limits",
        oldValue: "1/1",
        newValue: "2/1",
        note: null,
      },
      event: {
        eventType: "limits_updated",
        actor: ADMIN,
        payload: {
          before: { adAccounts: 1, identities: 1 },
          after: { adAccounts: 2, identities: 1 },
        },
      },
    });
  });

  test("writes nothing when the limits did not change", () => {
    expect(
      planMetaAssetLimitsUpdate({
        userId: USER_ID,
        current: null,
        adAccountLimit: 1,
        identityLimit: 1,
        hasActiveConnection: true,
        adminEmail: ADMIN,
        at: NOW,
      }),
    ).toEqual({ ok: true, changed: false });
  });

  test("without a connection the first row stores limits as pending/initial", () => {
    const result = planMetaAssetLimitsUpdate({
      userId: USER_ID,
      current: null,
      adAccountLimit: 2,
      identityLimit: 2,
      hasActiveConnection: false,
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      changed: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 2,
        identityLimit: 2,
        selectionStatus: "pending",
        pendingReason: "initial",
        pendingRequestedBy: null,
        pendingRequestedAt: NOW,
        selectedAt: null,
        selectedBy: null,
        selectionMode: null,
      },
      audit: {
        action: "update_meta_asset_limits",
        fieldName: "meta_asset_limits",
        oldValue: "1/1",
        newValue: "2/2",
        note: null,
      },
      event: {
        eventType: "limits_updated",
        actor: ADMIN,
        payload: {
          before: { adAccounts: 1, identities: 1 },
          after: { adAccounts: 2, identities: 2 },
        },
      },
    });
  });

  test("without a connection only stores the new limits", () => {
    const result = planMetaAssetLimitsUpdate({
      userId: USER_ID,
      current: {
        adAccountLimit: 1,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt: new Date("2026-08-01T12:00:00.000Z"),
        selectedBy: "user",
        selectionMode: "explicit",
      },
      adAccountLimit: 3,
      identityLimit: 1,
      hasActiveConnection: false,
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      changed: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 3,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt: new Date("2026-08-01T12:00:00.000Z"),
        selectedBy: "user",
        selectionMode: "explicit",
      },
      audit: {
        action: "update_meta_asset_limits",
        fieldName: "meta_asset_limits",
        oldValue: "1/1",
        newValue: "3/1",
        note: null,
      },
      event: {
        eventType: "limits_updated",
        actor: ADMIN,
        payload: {
          before: { adAccounts: 1, identities: 1 },
          after: { adAccounts: 3, identities: 1 },
        },
      },
    });
  });

  test("raising a limit on a fixed selection still opens pending/limit_changed", () => {
    const selectedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = planMetaAssetLimitsUpdate({
      userId: USER_ID,
      current: {
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt,
        selectedBy: "user",
        selectionMode: "explicit",
      },
      adAccountLimit: 3,
      identityLimit: 1,
      hasActiveConnection: true,
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      changed: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 3,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        pendingRequestedBy: ADMIN,
        pendingRequestedAt: NOW,
        selectedAt,
        selectedBy: "user",
        selectionMode: "explicit",
      },
      audit: {
        action: "update_meta_asset_limits",
        fieldName: "meta_asset_limits",
        oldValue: "2/1",
        newValue: "3/1",
        note: null,
      },
      event: {
        eventType: "limits_updated",
        actor: ADMIN,
        payload: {
          before: { adAccounts: 2, identities: 1 },
          after: { adAccounts: 3, identities: 1 },
        },
      },
    });
  });
});

describe("planMetaAssetSelectionRequest", () => {
  test("opens pending/support_requested with the observation", () => {
    const result = planMetaAssetSelectionRequest({
      userId: USER_ID,
      current: {
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt: new Date("2026-08-01T12:00:00.000Z"),
        selectedBy: "user",
        selectionMode: "explicit",
      },
      note: "A conta fixada não é a do cliente.",
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "support_requested",
        pendingRequestedBy: ADMIN,
        pendingRequestedAt: NOW,
        selectedAt: new Date("2026-08-01T12:00:00.000Z"),
        selectedBy: "user",
        selectionMode: "explicit",
      },
      audit: {
        action: "request_meta_asset_selection",
        fieldName: "meta_asset_selection",
        oldValue: "fixed",
        newValue: "pending",
        note: "A conta fixada não é a do cliente.",
      },
      event: {
        eventType: "selection_requested",
        actor: ADMIN,
        payload: {
          reason: "support_requested",
          note: "A conta fixada não é a do cliente.",
        },
      },
    });
  });

  test("asking again on a pending policy updates the note without changing the user", () => {
    const result = planMetaAssetSelectionRequest({
      userId: USER_ID,
      current: {
        adAccountLimit: 1,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "initial",
        pendingRequestedBy: "system",
        pendingRequestedAt: new Date("2026-09-01T10:00:00.000Z"),
        selectedAt: null,
        selectedBy: null,
        selectionMode: null,
      },
      note: "  Revisar de novo.  ",
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result.policy.userId).toBe(USER_ID);
    expect(result.policy.selectionStatus).toBe("pending");
    expect(result.policy.pendingReason).toBe("support_requested");
    expect(result.policy.pendingRequestedBy).toBe(ADMIN);
    expect(result.audit.oldValue).toBe("pending");
    expect(result.audit.note).toBe("Revisar de novo.");
    expect(result.event.payload).toEqual({
      reason: "support_requested",
      note: "Revisar de novo.",
    });
  });

  test("creates the first policy row with default 1/1 limits when none exists", () => {
    const result = planMetaAssetSelectionRequest({
      userId: USER_ID,
      current: null,
      note: "",
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result.policy).toEqual({
      userId: USER_ID,
      adAccountLimit: 1,
      identityLimit: 1,
      selectionStatus: "pending",
      pendingReason: "support_requested",
      pendingRequestedBy: ADMIN,
      pendingRequestedAt: NOW,
      selectedAt: null,
      selectedBy: null,
      selectionMode: null,
    });
    expect(result.audit.oldValue).toBeNull();
    expect(result.audit.note).toBeNull();
    expect(result.event.payload).toEqual({
      reason: "support_requested",
      note: null,
    });
  });
});

describe("planMetaAssetSelectionSet", () => {
  test("over_limit is refused with readable copy and the dialog stays on the helper", () => {
    const result = planMetaAssetSelectionSet({
      userId: USER_ID,
      current: {
        adAccountLimit: 1,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "initial",
        pendingRequestedBy: null,
        pendingRequestedAt: NOW,
        selectedAt: null,
        selectedBy: null,
        selectionMode: null,
      },
      granted: {
        adAccountIds: ["111", "222"],
        identityIds: ["page-a"],
      },
      proposal: {
        adAccounts: { chosenIds: ["111", "222"], primaryIds: ["111"] },
        identities: { chosenIds: ["page-a"], primaryIds: ["page-a"] },
      },
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({ ok: false, error: "over_limit" });
    expect(metaAssetSelectionErrorCopy("over_limit")).toEqual({
      message: "A escolha ultrapassa o limite de ativos deste tipo.",
      solution:
        "Desmarque itens até caber no limite ou peça ao suporte para aumentá-lo.",
    });
  });

  test("not_granted is refused with readable copy", () => {
    const result = planMetaAssetSelectionSet({
      userId: USER_ID,
      current: null,
      granted: {
        adAccountIds: ["111"],
        identityIds: ["page-a"],
      },
      proposal: {
        adAccounts: { chosenIds: ["999"], primaryIds: ["999"] },
        identities: { chosenIds: ["page-a"], primaryIds: ["page-a"] },
      },
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({ ok: false, error: "not_granted" });
    expect(metaAssetSelectionErrorCopy("not_granted")).toEqual({
      message:
        "Um dos ativos escolhidos não foi concedido pela conexão Meta atual.",
      solution:
        "Escolha apenas contas e identidades que aparecem na lista concedida.",
    });
  });

  test("missing_primary is refused with readable copy", () => {
    const result = planMetaAssetSelectionSet({
      userId: USER_ID,
      current: {
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "pending",
        pendingReason: "limit_changed",
        pendingRequestedBy: ADMIN,
        pendingRequestedAt: NOW,
        selectedAt: null,
        selectedBy: null,
        selectionMode: null,
      },
      granted: {
        adAccountIds: ["111", "222"],
        identityIds: ["page-a"],
      },
      proposal: {
        adAccounts: { chosenIds: ["111", "222"], primaryIds: [] },
        identities: { chosenIds: ["page-a"], primaryIds: ["page-a"] },
      },
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({ ok: false, error: "missing_primary" });
    expect(metaAssetSelectionErrorCopy("missing_primary")).toEqual({
      message: "Falta marcar o ativo principal deste tipo.",
      solution: "Indique qual conta ou identidade é a principal.",
    });
  });

  test("a valid proposal fixes the policy as explicit, with one primary per type, audit summary and admin event", () => {
    const result = planMetaAssetSelectionSet({
      userId: USER_ID,
      current: {
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt: new Date("2026-08-01T12:00:00.000Z"),
        selectedBy: "user",
        selectionMode: "implicit",
      },
      granted: {
        adAccountIds: ["111", "222"],
        identityIds: ["page-a"],
      },
      proposal: {
        adAccounts: { chosenIds: ["111", "222"], primaryIds: ["222"] },
        identities: { chosenIds: ["page-a"], primaryIds: [] },
      },
      previouslyEnabled: [
        { kind: "ad_account", id: "111", isPrimary: true },
      ],
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result).toEqual({
      ok: true,
      policy: {
        userId: USER_ID,
        adAccountLimit: 2,
        identityLimit: 1,
        selectionStatus: "fixed",
        pendingReason: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
        selectedAt: NOW,
        selectedBy: ADMIN,
        selectionMode: "explicit",
      },
      audit: {
        action: "set_meta_asset_selection",
        fieldName: "meta_asset_selection",
        oldValue: "contas 111 (principal) · identidades —",
        newValue: "contas 111, 222 (principal) · identidades page-a (principal)",
        note: null,
      },
      event: {
        eventType: "selection_set_by_admin",
        actor: ADMIN,
        payload: {
          adAccounts: { chosenIds: ["111", "222"], primaryIds: ["222"] },
          identities: { chosenIds: ["page-a"], primaryIds: ["page-a"] },
          selectionMode: "explicit",
        },
      },
      assets: [
        { kind: "ad_account", id: "111", isPrimary: false },
        { kind: "ad_account", id: "222", isPrimary: true },
        { kind: "identity", id: "page-a", isPrimary: true },
      ],
    });
  });

  test("a kind with no granted assets stays empty and still fixes", () => {
    const result = planMetaAssetSelectionSet({
      userId: USER_ID,
      current: null,
      granted: {
        adAccountIds: ["111"],
        identityIds: [],
      },
      proposal: {
        adAccounts: { chosenIds: ["111"], primaryIds: [] },
        identities: { chosenIds: [], primaryIds: [] },
      },
      adminEmail: ADMIN,
      at: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual([
      { kind: "ad_account", id: "111", isPrimary: true },
    ]);
    expect(result.audit.newValue).toBe(
      "contas 111 (principal) · identidades —",
    );
  });
});
