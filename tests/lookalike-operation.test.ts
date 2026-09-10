import assert from "node:assert/strict";
import test from "node:test";

import { confirmLookalikeAudience, reviewLookalikeAudience } from "../lib/meta-business/marketing/audiences/lookalike-operation";
import type { AudienceCommandRecord, AudienceCommandStore } from "../lib/meta-business/marketing/audiences/command-store";
import { ensureMetaTestEnv, installMetaFetchStub } from "./helpers/meta-fetch-stub";

ensureMetaTestEnv();

function commandStore(): AudienceCommandStore {
  const records = new Map<string, AudienceCommandRecord>();
  return {
    async claim({ commandId }) { const existing = records.get(commandId); if (existing) return { ...existing, acquired: false }; const pending: AudienceCommandRecord = { commandId, status: "pending", acquired: true }; records.set(commandId, pending); return pending; },
    async get(commandId) { return records.get(commandId); },
    async complete(commandId, result) { records.set(commandId, { commandId, status: "completed", result }); },
    async markUncertain(commandId) { records.set(commandId, { commandId, status: "uncertain" }); },
  };
}

test("lookalike confirmation uses one command identity and never creates a duplicate on retry", async () => {
  const stub = installMetaFetchStub((request) => request.method === "GET" ? { body: { data: [{ id: "SEED", name: "Site", subtype: "WEBSITE" }] } } : { body: { id: "LAL1" } });
  const store = commandStore();
  const input = { adAccountId: "act_123", accessToken: "token", originAudienceId: "SEED", name: "Semelhante 1%", country: "br", percentage: 1 };
  try {
    const reviewed = await reviewLookalikeAudience(input);
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;
    const confirmed = await confirmLookalikeAudience({ ...input, confirmationToken: reviewed.confirmationToken, commandId: reviewed.commandId, actorUserId: "user-1", commandStore: store });
    assert.deepEqual(confirmed, { ok: true, id: "LAL1", data: { id: "LAL1", state: "submitted" } });
    const retried = await confirmLookalikeAudience({ ...input, confirmationToken: reviewed.confirmationToken, commandId: reviewed.commandId, actorUserId: "user-1", commandStore: store });
    assert.deepEqual(retried, confirmed);
    assert.equal(stub.realCalls().filter((request) => request.method === "POST").length, 1);
  } finally { stub.restore(); }
});
