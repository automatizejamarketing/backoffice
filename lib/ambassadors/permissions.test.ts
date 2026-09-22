import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
test("ambassador membership does not grant billing or generic account edits; Starter requires explicit permission", () => {
  const actor: BackofficeActor = {
    id: "member",
    email: "member@example.com",
    role: "comercial",
    source: "database",
  };
  assert.equal(hasBackofficePermission(actor, "ambassadors:manage"), false);
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorAccess: true },
      "ambassadors:manage",
    ),
    true,
  );
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorAccess: true },
      "ambassadors:grant",
    ),
    false,
  );
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorAccess: true, ambassadorGrant: true },
      "ambassadors:grant",
    ),
    true,
  );
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorGrant: true },
      "ambassadors:grant",
    ),
    false,
  );
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorAccess: true, ambassadorGrant: true },
      "billing:manage",
    ),
    false,
  );
  assert.equal(
    hasBackofficePermission(
      { ...actor, ambassadorAccess: true, ambassadorGrant: true },
      "users:manage",
    ),
    false,
  );
  assert.equal(
    hasBackofficePermission({ ...actor, role: "admin" }, "ambassadors:grant"),
    true,
  );
  assert.equal(
    hasBackofficePermission({ ...actor, role: "dev" }, "ambassadors:manage"),
    false,
  );
});
