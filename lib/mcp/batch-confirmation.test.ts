import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BATCH_CONFIRMATION_TTL_MS, batchConfirmationCode, verifyBatchConfirmation } from "./batch-confirmation";

describe("batch confirmation code", () => {
  const batch = [["u1", "c1", "pause", null, "sem resultado", []], ["u2", "a1", "set_daily_budget", 60, "escala", ["i1"]]];
  const now = Date.parse("2026-10-13T15:00:00Z");

  it("verifies the exact batch shown in the preview", () => {
    assert.equal(verifyBatchConfirmation(batchConfirmationCode(batch, "s", now), batch, "s", now + 1000), "ok");
  });

  it("rejects a changed batch or another secret", () => {
    const code = batchConfirmationCode(batch, "s", now);
    assert.equal(verifyBatchConfirmation(code, batch.slice(0, 1), "s", now), "mismatch");
    assert.equal(verifyBatchConfirmation(code, [batch[0], ["u2", "a1", "set_daily_budget", 600, "escala", ["i1"]]], "s", now), "mismatch");
    assert.equal(verifyBatchConfirmation(code, batch, "other", now), "mismatch");
    assert.equal(verifyBatchConfirmation("garbage", batch, "s", now), "mismatch");
  });

  it("expires, and a forged expiry does not verify", () => {
    const code = batchConfirmationCode(batch, "s", now);
    assert.equal(verifyBatchConfirmation(code, batch, "s", now + BATCH_CONFIRMATION_TTL_MS + 1), "expired");
    const forged = `${(now + 10 * BATCH_CONFIRMATION_TTL_MS).toString(36)}.${code.split(".")[1]}`;
    assert.equal(verifyBatchConfirmation(forged, batch, "s", now + BATCH_CONFIRMATION_TTL_MS + 1), "mismatch");
  });
});
