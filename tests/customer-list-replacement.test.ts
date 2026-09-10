import assert from "node:assert/strict";
import test from "node:test";

import type { CustomerFilePreview } from "../lib/meta-business/marketing/audiences/customer-file";
import {
  executeCustomerListReplacement,
  sendCustomerListReplacementBatch,
  type CustomerListReplacement,
} from "../lib/meta-business/marketing/audiences/customer-list-replacement";
import { ensureMetaTestEnv, installMetaFetchStub } from "./helpers/meta-fetch-stub";

const receivedAt = new Date("2026-09-09T00:00:00Z");

function preview(rows = 10_001, invalid = 0): CustomerFilePreview {
  const entries = Array.from({ length: rows + invalid }, (_, index) => ({
    line: index + 2,
    values: { email: `cliente-${index}@example.com` },
    identifiers: index < rows ? { email: `cliente-${index}@example.com` } : {},
    warnings: [],
    valid: index < rows,
  }));
  return {
    format: "csv",
    context: { customerId: "customer-1", adAccountId: "123", audienceId: "meta-list-1", operation: "replace" },
    mapping: { emailColumn: "email" }, referenceCountry: "BR", receivedAt,
    expiresAt: new Date("2026-09-10T00:00:00Z"), rows: entries,
    counts: { read: entries.length, valid: rows, invalid, warnings: 0, duplicatesRemoved: 0 },
  };
}

function replacement(): CustomerListReplacement {
  return {
    id: "replace-1", audienceIdentity: "meta-list-1", audienceId: "meta-list-1",
    customerId: "customer-1", adAccountId: "123", state: "awaiting_confirmation",
    receivedAt, confirmedBatches: [], receipts: [], sessionId: "session-1", sessionStartedAt: receivedAt,
  };
}

function dependencies(sent: number[] = []) {
  return {
    store: {
      acquire: async () => ({ token: "lease" }), stillOwns: async () => true,
      save: async () => {}, discardTemporary: async () => {},
    },
    authorize: async () => {},
    reconcile: async () => ({ safeToContinue: true, sessionId: "session-1", confirmedBatches: [] }),
    send: async (request: { sequence: number; lastBatch: boolean; sessionId: string }) => {
      sent.push(request.sequence);
      assert.equal(request.sessionId, "session-1");
      return { num_received: request.sequence === 0 ? 10_000 : 1 };
    },
    now: () => new Date("2026-09-09T00:30:00Z"),
  };
}

test("replaces the intended complete list through one sequenced usersreplace session", async () => {
  const sent: number[] = [];
  const result = await executeCustomerListReplacement({ replacement: replacement(), preview: preview() }, dependencies(sent));
  assert.equal(result.state, "completed");
  assert.deepEqual(result.confirmedBatches, [0, 1]);
  assert.deepEqual(sent, [0, 1]);
});

test("uses the v25 usersreplace session, sequence, and final-batch fields", async () => {
  ensureMetaTestEnv();
  const stub = installMetaFetchStub(() => ({ body: { num_received: 1 } }));
  try {
    await sendCustomerListReplacementBatch({
      audienceId: "meta-list-1", accessToken: "token", sessionId: "session-1", sequence: 1, lastBatch: true,
      batch: { schema: ["EMAIL"], data: [["hash"]] },
    });
    const call = stub.realCalls()[0]!;
    assert.equal(call.method, "POST");
    assert.equal(call.path, "meta-list-1/usersreplace");
    assert.equal(call.params.get("session_id"), "session-1");
    assert.equal(call.params.get("batch_seq"), "1");
    assert.equal(call.params.get("last_batch_flag"), "true");
  } finally { stub.restore(); }
});

test("requires a corrected replacement preview and never starts a mutation for it", async () => {
  const deps = dependencies();
  await assert.rejects(executeCustomerListReplacement({ replacement: replacement(), preview: preview(1, 1) }, deps), /REPLACEMENT_REQUIRES_CORRECTED_FILE/);
});

test("reconciles an interruption before continuing without resending the confirmed first batch", async () => {
  const sent: number[] = [];
  const item = { ...replacement(), state: "unknown" as const, confirmedBatches: [0] };
  const result = await executeCustomerListReplacement({ replacement: item, preview: preview() }, {
    ...dependencies(sent),
    reconcile: async () => ({ safeToContinue: true, sessionId: "session-1", confirmedBatches: [0] }),
  });
  assert.equal(result.state, "completed");
  assert.deepEqual(sent, [1]);
});

test("does not restart an uncertain or expired replacement session", async () => {
  const saved: CustomerListReplacement[] = [];
  const uncertain = await executeCustomerListReplacement({ replacement: { ...replacement(), state: "unknown" }, preview: preview(1) }, {
    ...dependencies(), reconcile: async () => ({ safeToContinue: false }),
    store: { acquire: async () => ({ token: "lease" }), stillOwns: async () => true, save: async (item) => { saved.push(item); }, discardTemporary: async () => {} },
  });
  assert.equal(uncertain.state, "action_required");
  assert.equal(saved.at(-1)?.state, "action_required");

  let sends = 0;
  const expired = await executeCustomerListReplacement({ replacement: replacement(), preview: preview(1) }, {
    ...dependencies(), now: () => new Date("2026-09-09T01:31:00Z"),
    send: async () => { sends += 1; return {}; },
  });
  assert.equal(expired.state, "action_required");
  assert.equal(sends, 0);
});

