import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  normalizeInvitationEmail,
} from "./invitation-token";

describe("agency invitation token (parity with the frontend)", () => {
  it("hashes the shared test vector exactly like the frontend", () => {
    assert.equal(
      hashInvitationToken("A".repeat(43)),
      "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
    );
  });

  it("creates a 43-char url-safe token", () => {
    const { token, tokenHash } = createInvitationToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashInvitationToken(token), tokenHash);
  });

  it("expires in seven days and normalizes emails", () => {
    assert.equal(
      invitationExpiresAt(new Date("2026-10-07T12:00:00Z")).toISOString(),
      "2026-10-14T12:00:00.000Z",
    );
    assert.equal(normalizeInvitationEmail(" Dono@Infinite.com "), "dono@infinite.com");
    assert.equal(normalizeInvitationEmail("dono"), null);
  });
});
