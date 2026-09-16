import { describe, expect, it } from "bun:test";
import { defaultAdminReconnectMode } from "./admin-oauth-utils";

describe("admin oauth", () => {
  it("defaults to classic consultant user tokens", () => {
    expect(defaultAdminReconnectMode({})).toBe("user");
    expect(defaultAdminReconnectMode({ META_ADMIN_RECONNECT_MODE: "bisu" })).toBe(
      "bisu",
    );
  });
});
