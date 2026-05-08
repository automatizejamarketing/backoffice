import { describe, expect, test } from "bun:test";
import { sanitizeMetaBusinessAccount } from "./sanitize";

describe("sanitizeMetaBusinessAccount", () => {
  test("removes the stored Meta access token from API responses", () => {
    const sanitized = sanitizeMetaBusinessAccount({
      id: "meta-1",
      userId: "user-1",
      facebookUserId: "facebook-1",
      name: "Meta User",
      pictureUrl: null,
      accessToken: "secret-token",
      tokenExpiresAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-02-01T00:00:00Z"),
      deletedAt: null,
    });

    expect(JSON.stringify(sanitized)).toBe(JSON.stringify({
      id: "meta-1",
      userId: "user-1",
      facebookUserId: "facebook-1",
      name: "Meta User",
      pictureUrl: null,
      tokenExpiresAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-02-01T00:00:00Z"),
      deletedAt: null,
    }));
    expect(sanitized === null ? false : "accessToken" in sanitized).toBe(false);
  });

  test("preserves null accounts", () => {
    expect(sanitizeMetaBusinessAccount(null)).toBe(null);
  });
});
