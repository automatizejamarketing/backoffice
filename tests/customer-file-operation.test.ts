import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_FILE_BATCH_SIZE,
  buildCustomerFileBatches,
  classifyCustomerFileReceipt,
  customerFileUsageAvailability,
  executeCustomerFileOperation,
} from "../lib/meta-business/marketing/audiences/customer-file-operation";

test("builds v25 batches with a stable schema and SHA-256 identifiers", () => {
  const batches = buildCustomerFileBatches([
    { email: "cliente@example.com", phone: "+5511987654321" },
    { email: "only@example.com" },
  ]);

  assert.equal(CUSTOMER_FILE_BATCH_SIZE, 10_000);
  assert.deepEqual(batches[0], {
    schema: ["EMAIL", "PHONE"],
    data: [
      ["13e2c3f390a91763c2b83e0e6222dfc3c967ef82fc86c3648b00a90d977490de", "38225ec3dccec4189659c110ddc4f3dc9c27539850cb6a9ddae31ae03a5cf441"],
      ["e944127779df3ff9aa8bce75b6e1a157170580b3ff55555d1fb62ae1144f3e13", ""],
    ],
  });
});

test("keeps a timed-out batch unknown instead of blindly retrying it", async () => {
  const saved: string[] = [];
  const result = await executeCustomerFileOperation({
    id: "op-1", audienceIdentity: "meta-audience-1", operation: "add", state: "awaiting_confirmation",
    receivedAt: new Date(), confirmedBatches: [], receipts: [], rows: [{ email: "cliente@example.com" }],
  }, {
    store: {
      acquire: async () => ({ token: "lease" }), stillOwns: async () => true,
      save: async (execution) => { saved.push(execution.state); }, discardTemporary: async () => assert.fail("must retain data to reconcile"),
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }),
    send: async () => { throw new Error("transport timeout"); },
  });
  assert.equal(result.state, "unknown");
  assert.deepEqual(saved, ["running", "unknown"]);
});

test("treats a successful receipt with rejected entries as a compromised partial result", () => {
  assert.deepEqual(classifyCustomerFileReceipt({ num_received: 2, num_invalid_entries: 1 }, 2), {
    state: "partial",
    confirmed: 1,
    rejected: 1,
  });
  assert.deepEqual(customerFileUsageAvailability("partial"), {
    include: "blocked",
    exclude: "blocked",
    lookalikeSource: "blocked",
  });
  assert.deepEqual(customerFileUsageAvailability("completed"), {
    include: "available",
    exclude: "available",
    lookalikeSource: "available",
  });
});

test("persists a partial receipt and revalidates authorization before every batch", async () => {
  const saved: Array<{ state: string; receipts: unknown[] }> = [];
  const partial = await executeCustomerFileOperation({
    id: "op-partial", audienceIdentity: "meta-audience-1", operation: "remove", state: "awaiting_confirmation",
    receivedAt: new Date(), confirmedBatches: [], receipts: [], rows: [{ email: "cliente@example.com" }],
  }, {
    store: {
      acquire: async () => ({ token: "lease" }), stillOwns: async () => true,
      save: async (execution) => { saved.push({ state: execution.state, receipts: execution.receipts }); }, discardTemporary: async () => {},
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }),
    send: async () => ({ num_received: 1, num_invalid_entries: 1 }),
  });
  assert.equal(partial.state, "partial");
  assert.deepEqual(saved.at(-1), { state: "partial", receipts: [{ sequence: 0, received: 1, rejected: 1 }] });

  let authorizationChecks = 0;
  let sends = 0;
  await assert.rejects(executeCustomerFileOperation({
    id: "op-revoked", audienceIdentity: "meta-audience-1", operation: "remove", state: "awaiting_confirmation",
    receivedAt: new Date(), confirmedBatches: [], receipts: [],
    rows: Array.from({ length: CUSTOMER_FILE_BATCH_SIZE + 1 }, (_, index) => ({ email: `cliente-${index}@example.com` })),
  }, {
    store: { acquire: async () => ({ token: "lease" }), stillOwns: async () => true, save: async () => {}, discardTemporary: async () => {} },
    authorize: async () => { authorizationChecks += 1; if (authorizationChecks > 2) throw new Error("authorization revoked"); },
    revalidateRemote: async () => ({ safeToContinue: true }), send: async () => { sends += 1; return {}; },
  }), /authorization revoked/);
  assert.equal(sends, 1);
});

