import { describe, expect, test } from "bun:test";
import {
  BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
  createBackofficeMagicSessionToken,
  verifyBackofficeMagicSessionToken,
} from "./magic-session";

const secret = "test-secret";
const now = new Date("2026-01-01T00:00:00.000Z");

describe("backoffice magic session", () => {
  test("creates a normalized long-lived session token", () => {
    const token = createBackofficeMagicSessionToken(" User@Example.COM ", {
      now,
      secret,
    });

    const session = verifyBackofficeMagicSessionToken(token, {
      now,
      secret,
    });

    expect(session?.email).toBe("user@example.com");
    expect(session?.expiresAt.getTime()).toBe(
      now.getTime() + BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS * 1000,
    );
  });

  test("rejects tampered tokens", () => {
    const token = createBackofficeMagicSessionToken("user@example.com", {
      now,
      secret,
    });
    const tamperedToken = `${token.slice(0, -1)}x`;

    expect(
      verifyBackofficeMagicSessionToken(tamperedToken, { now, secret }),
    ).toBe(null);
  });

  test("rejects expired tokens", () => {
    const token = createBackofficeMagicSessionToken("user@example.com", {
      now,
      secret,
    });
    const afterExpiry = new Date(
      now.getTime() + BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS * 1000 + 1000,
    );

    expect(
      verifyBackofficeMagicSessionToken(token, {
        now: afterExpiry,
        secret,
      }),
    ).toBe(null);
  });
});
