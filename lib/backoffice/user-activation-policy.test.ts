import { describe, expect, test } from "bun:test";
import {
  buildUserActivationUrl,
  canManageUserActivation,
} from "./user-activation-policy";

describe("user activation policy", () => {
  test("allows activation actions only for unverified credential accounts", () => {
    expect(
      canManageUserActivation({
        authProvider: "credentials",
        emailVerified: null,
      }),
    ).toBe(true);
    expect(
      canManageUserActivation({
        authProvider: "credentials",
        emailVerified: new Date(),
      }),
    ).toBe(false);
    expect(
      canManageUserActivation({ authProvider: "google", emailVerified: null }),
    ).toBe(false);
  });

  test("builds the frontend activation URL with an encoded token", () => {
    expect(
      buildUserActivationUrl(
        "token with/slash",
        "https://www.automatizemarketing.com/",
      ),
    ).toBe(
      "https://www.automatizemarketing.com/ativar?token=token+with%2Fslash",
    );
  });
});
