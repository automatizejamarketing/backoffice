import { describe, expect, it } from "bun:test";
import { defaultAdminReconnectMode } from "./admin-oauth-utils";

describe("admin oauth", () => {
  it("defaults to the same BISU Login for Business as customer Connect", () => {
    expect(defaultAdminReconnectMode({})).toBe("bisu");
    expect(
      defaultAdminReconnectMode({ META_ADMIN_RECONNECT_MODE: "user" }),
    ).toBe("user");
  });
});
