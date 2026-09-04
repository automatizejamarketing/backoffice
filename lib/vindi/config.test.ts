import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
// @ts-expect-error Bun provides this test helper at runtime in this repository.
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { isVindiSubscriptionsEnabled } = await import("./config");

const originalSubscriptions = process.env.VINDI_SUBSCRIPTIONS_ENABLED;

afterEach(() => {
  if (originalSubscriptions === undefined) {
    delete process.env.VINDI_SUBSCRIPTIONS_ENABLED;
  } else {
    process.env.VINDI_SUBSCRIPTIONS_ENABLED = originalSubscriptions;
  }
});

describe("isVindiSubscriptionsEnabled", () => {
  it("stays off when the cut flag is unset", () => {
    delete process.env.VINDI_SUBSCRIPTIONS_ENABLED;
    assert.equal(isVindiSubscriptionsEnabled(), false);
  });

  it("turns on only when the flag is the string true", () => {
    process.env.VINDI_SUBSCRIPTIONS_ENABLED = "true";
    assert.equal(isVindiSubscriptionsEnabled(), true);
    process.env.VINDI_SUBSCRIPTIONS_ENABLED = "1";
    assert.equal(isVindiSubscriptionsEnabled(), false);
  });
});
