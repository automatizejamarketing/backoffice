import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTransitionPayout } from "./payout";

describe("expert payout policy", () => {
  it("allows only forward administrative transitions", () => {
    assert.equal(canTransitionPayout("requested", "approved"), true);
    assert.equal(canTransitionPayout("approved", "paid"), true);
    assert.equal(canTransitionPayout("rejected", "paid"), false);
    assert.equal(canTransitionPayout("paid", "approved"), false);
  });
});
