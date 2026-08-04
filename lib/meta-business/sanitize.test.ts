import { describe, expect, test } from "bun:test";
import { sanitizeMetaBusinessAccount } from "./sanitize";

describe("sanitizeMetaBusinessAccount", () => {
  test("removes the stored Meta access token from API responses", () => {
    const sanitized = sanitizeMetaBusinessAccount({
      id: "meta-1",
      userId: "user-1",
      facebookUserId: "facebook-1",
      bisuAppScopedId: null,
      clientBusinessId: null,
      name: "Meta User",
      pictureUrl: null,
      tokenKind: "user",
      configId: null,
      grantedScopes: null,
      assignedAssets: null,
      connectionStatus: "active",
      lastValidatedAt: null,
      lastValidationError: null,
      accessToken: "secret-token",
      tokenExpiresAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-02-01T00:00:00Z"),
      deletedAt: null,
    });

    expect(sanitized === null ? false : "accessToken" in sanitized).toBe(false);
    expect(sanitized?.id).toBe("meta-1");
    expect(sanitized?.facebookUserId).toBe("facebook-1");
    expect(sanitized?.tokenKind).toBe("user");
    expect(sanitized?.connectionStatus).toBe("active");
  });

  test("preserves BISU metadata without leaking the token", () => {
    const sanitized = sanitizeMetaBusinessAccount({
      id: "meta-bisu",
      userId: "user-1",
      facebookUserId: null,
      bisuAppScopedId: "bisu-1",
      clientBusinessId: "biz-1",
      name: "Client Business",
      pictureUrl: null,
      tokenKind: "bisu",
      configId: "config-1",
      grantedScopes: ["ads_management"],
      assignedAssets: null,
      connectionStatus: "active",
      lastValidatedAt: null,
      lastValidationError: null,
      accessToken: "enc:v1:iv:tag:cipher",
      tokenExpiresAt: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-02-01T00:00:00Z"),
      deletedAt: null,
    });

    expect(sanitized === null ? false : "accessToken" in sanitized).toBe(false);
    expect(sanitized?.tokenKind).toBe("bisu");
    expect(sanitized?.bisuAppScopedId).toBe("bisu-1");
    expect(sanitized?.clientBusinessId).toBe("biz-1");
  });

  test("preserves null accounts", () => {
    expect(sanitizeMetaBusinessAccount(null)).toBe(null);
  });
});
