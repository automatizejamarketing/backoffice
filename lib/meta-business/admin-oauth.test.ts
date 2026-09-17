import { describe, expect, it } from "bun:test";
import {
  defaultAdminReconnectMode,
  isAdminOauthState,
} from "./admin-oauth-utils";

describe("admin oauth", () => {
  it("defaults to the same BISU Login for Business as customer Connect", () => {
    expect(defaultAdminReconnectMode({})).toBe("bisu");
    expect(
      defaultAdminReconnectMode({ META_ADMIN_RECONNECT_MODE: "user" }),
    ).toBe("user");
  });

  it("prefixes consultant state so the customer callback can keep it off /login", () => {
    expect(isAdminOauthState("adm.abc")).toBe(true);
    expect(isAdminOauthState("customer-state")).toBe(false);
  });
});
