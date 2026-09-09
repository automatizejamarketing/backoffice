import assert from "node:assert/strict";
import test from "node:test";

import type { CustomerFilePreview } from "../lib/meta-business/marketing/audiences/customer-file";
import {
  executeCustomerListRemoval,
  type CustomerListRemoval,
} from "../lib/meta-business/marketing/audiences/customer-list-removal";
import { sendCustomerFileBatch } from "../lib/meta-business/marketing/audiences/customer-file-operation";
import { ensureMetaTestEnv, installMetaFetchStub } from "./helpers/meta-fetch-stub";

function preview(valid: number, invalid = 0): CustomerFilePreview {
  const rows = Array.from({ length: valid + invalid }, (_, index) => ({
    line: index + 2,
    values: { email: `cliente-${index}@example.com` },
    identifiers: index < valid ? { email: `cliente-${index}@example.com` } : {},
    warnings: [],
    valid: index < valid,
  }));
  return {
    format: "csv",
    context: { customerId: "customer-1", adAccountId: "123", audienceId: "meta-list-1", operation: "remove" },
    mapping: { emailColumn: "email" }, referenceCountry: "BR",
    receivedAt: new Date("2026-09-09T00:00:00Z"),
    expiresAt: new Date("2026-09-10T00:00:00Z"), rows,
    counts: { read: rows.length, valid, invalid, warnings: 0, duplicatesRemoved: 0 },
  };
}

function removal(): CustomerListRemoval {
  return {
    id: "remove-1", audienceIdentity: "meta-list-1", audienceId: "meta-list-1",
    customerId: "customer-1", adAccountId: "123", state: "awaiting_confirmation",
    receivedAt: new Date("2026-09-09T00:00:00Z"), confirmedBatches: [], receipts: [],
  };
}

test("removes approved customer-file identifiers through the v25 DELETE users edge", async () => {
  ensureMetaTestEnv();
  const stub = installMetaFetchStub(() => ({ body: { num_received: 1 } }));
  try {
    await sendCustomerFileBatch({
      audienceId: "meta-list-1", accessToken: "token", operation: "remove",
      batch: { schema: ["EMAIL"], data: [["hash"]] },
    });
    assert.equal(stub.realCalls()[0]?.method, "DELETE");
    assert.equal(stub.realCalls()[0]?.path, "meta-list-1/users");
    assert.equal(stub.realCalls()[0]?.params.get("schema"), '["EMAIL"]');
    assert.equal(stub.realCalls()[0]?.params.get("data"), '[["hash"]]');
  } finally { stub.restore(); }
});

test("removes only explicitly approved valid rows and records receipt evidence without members", async () => {
  const saved: CustomerListRemoval[] = [];
  const result = await executeCustomerListRemoval({ removal: removal(), preview: preview(1, 1), explicitlySendValidRows: true }, {
    store: {
      acquire: async () => ({ token: "lease" }), stillOwns: async () => true,
      save: async (item) => { saved.push(item); }, discardTemporary: async () => {},
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }),
    send: async (request) => {
      assert.equal(request.operation, "remove");
      assert.equal(request.batch.data.length, 1);
      return { num_received: 1 };
    },
    now: () => new Date("2026-09-09T01:00:00Z"),
  });

  assert.equal(result.state, "completed");
  assert.equal(result.receipts[0]?.received, 1);
  assert.deepEqual(saved.at(-1), result);
  assert.equal("rows" in result, false);
});

test("does not begin a removal for zero valid rows or after authorization is revoked", async () => {
  const deps = {
    store: {
      acquire: async () => assert.fail("must not acquire"), stillOwns: async () => true,
      save: async () => {}, discardTemporary: async () => {},
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }), send: async () => ({}),
  };
  await assert.rejects(executeCustomerListRemoval({ removal: removal(), preview: preview(0), explicitlySendValidRows: false }, deps), /NO_VALID_ROWS/);
  const expiredPreview = preview(1);
  expiredPreview.expiresAt = new Date("2026-09-08T00:00:00Z");
  await assert.rejects(executeCustomerListRemoval({ removal: removal(), preview: expiredPreview, explicitlySendValidRows: false }, deps), /expirou/i);
  await assert.rejects(executeCustomerListRemoval({ removal: removal(), preview: preview(1), explicitlySendValidRows: false }, { ...deps, authorize: async () => { throw new Error("authorization revoked"); } }), /authorization revoked/);
});

test("does not enqueue a concurrent removal and leaves a lost response uncertain", async () => {
  await assert.rejects(executeCustomerListRemoval({ removal: removal(), preview: preview(1), explicitlySendValidRows: false }, {
    store: {
      acquire: async () => null, stillOwns: async () => true,
      save: async () => {}, discardTemporary: async () => {},
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }), send: async () => ({}),
  }), /importa\u00e7\u00e3o em andamento/);

  const result = await executeCustomerListRemoval({ removal: removal(), preview: preview(1), explicitlySendValidRows: false }, {
    store: {
      acquire: async () => ({ token: "lease" }), stillOwns: async () => true,
      save: async () => {}, discardTemporary: async () => assert.fail("must retain data for reconciliation"),
    },
    authorize: async () => {}, revalidateRemote: async () => ({ safeToContinue: true }),
    send: async () => { throw new Error("timeout after remote send"); },
  });
  assert.equal(result.state, "unknown");
});

