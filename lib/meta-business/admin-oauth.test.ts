import { describe, expect, it } from "bun:test";
import { defaultAdminReconnectMode } from "./admin-oauth-utils";

describe("admin oauth", () => {
  it("defaults consultant reconnect to Login for Business (BISU)", () => {
    expect(defaultAdminReconnectMode({})).toBe("bisu");
    expect(defaultAdminReconnectMode({ META_ADMIN_RECONNECT_MODE: "bisu" })).toBe(
      "bisu",
    );
    expect(defaultAdminReconnectMode({ META_ADMIN_RECONNECT_MODE: "user" })).toBe(
      "user",
    );
  });
});
