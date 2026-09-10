import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOMER_LIST_SOURCE, createCustomerListAudience, executeCustomerListCreation, type CustomerListCreation } from "../lib/meta-business/marketing/audiences/customer-list-creation";
import type { CustomerFilePreview } from "../lib/meta-business/marketing/audiences/customer-file";
import { previewCustomAudience } from "../lib/meta-business/marketing/audiences/create";

function preview(valid: number, invalid = 0): CustomerFilePreview {
  const rows = Array.from({ length: valid + invalid }, (_, index) => ({
    line: index + 2, values: { email: `cliente-${index}@example.com` },
    identifiers: index < valid ? { email: `cliente-${index}@example.com` } : {},
    warnings: [], valid: index < valid,
  }));
  return {
    format: "csv", context: { customerId: "customer-1", adAccountId: "123", operation: "create" },
    mapping: { emailColumn: "email" }, referenceCountry: "BR", receivedAt: new Date("2026-09-09T00:00:00Z"),
    expiresAt: new Date("2026-09-10T00:00:00Z"), rows,
    counts: { read: rows.length, valid, invalid, warnings: 0, duplicatesRemoved: 0 },
  };
}

function creation(): CustomerListCreation {
  return { id: "create-1", audienceIdentity: "create:create-1", state: "awaiting_confirmation", name: "Clientes", customerId: "customer-1", adAccountId: "123", receivedAt: new Date("2026-09-09T00:00:00Z") };
}

function dependencies(overrides: Partial<Parameters<typeof executeCustomerListCreation>[1]> = {}) {
  return {
    store: { acquire: async () => ({ token: "lease" }), stillOwns: async () => true, bindAudienceIdentity: async () => true, save: async () => {}, discardTemporary: async () => {} },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }),
    createAudience: async () => ({ id: "meta-list-1" }), reconcileCreation: async () => undefined,
    send: async () => ({}), now: () => new Date("2026-09-09T01:00:00Z"), ...overrides,
  };
}

test("creates one declared customer list and sends the approved first load", async () => {
  const result = await executeCustomerListCreation({ creation: creation(), preview: preview(1), explicitlySendValidRows: false }, dependencies());
  assert.equal(result.audienceId, "meta-list-1");
  assert.equal(result.state, "completed");
});

test("builds the Meta v25 customer-list shell with its declared source", async () => {
  const result = await previewCustomAudience({ type: "raw", subtype: "CUSTOM", customerFileSource: CUSTOMER_LIST_SOURCE, name: "Clientes", adAccountId: "123", accessToken: "token" });
  assert.deepEqual(result, { ok: true, payload: { name: "Clientes", subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY" } });
});

test("previews the v25 customer-list shell with its declared source", async () => {
  const result = await previewCustomAudience({ type: "raw", subtype: "CUSTOM", customerFileSource: CUSTOMER_LIST_SOURCE, name: "Clientes", adAccountId: "123", accessToken: "token" });
  assert.deepEqual(result, { ok: true, payload: { name: "Clientes", subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY" } });
});

test("does not create an audience when the approved preview has no valid rows", async () => {
  await assert.rejects(executeCustomerListCreation({ creation: creation(), preview: preview(0), explicitlySendValidRows: false }, dependencies({ createAudience: async () => assert.fail("must not create") })), /NO_VALID_ROWS/);
});

test("returns a readable error for a preview belonging to another account", async () => {
  const foreignPreview = preview(1);
  foreignPreview.context.adAccountId = "456";
  await assert.rejects(executeCustomerListCreation({ creation: creation(), preview: foreignPreview, explicitlySendValidRows: false }, dependencies({ createAudience: async () => assert.fail("must not create") })), /não pertence ao cliente ou à conta/);
});

test("reconciles a failed create without blindly creating a second audience", async () => {
  let creates = 0;
  const result = await executeCustomerListCreation({ creation: creation(), preview: preview(1), explicitlySendValidRows: false }, dependencies({ createAudience: async () => { creates += 1; throw new Error("timeout"); }, reconcileCreation: async () => ({ id: "meta-list-1" }), send: async () => { throw new Error("first load failed"); } }));
  assert.equal(creates, 1);
  assert.equal(result.state, "unknown");
});

test("repeating a creation command with its persisted Meta ID does not create another list", async () => {
  let creates = 0;
  const result = await executeCustomerListCreation({ creation: { ...creation(), audienceId: "meta-list-1", audienceIdentity: "meta-list-1" }, preview: preview(1), explicitlySendValidRows: false }, dependencies({ createAudience: async () => { creates += 1; return { id: "must-not-exist" }; } }));
  assert.equal(creates, 0);
  assert.equal(result.audienceId, "meta-list-1");
});
