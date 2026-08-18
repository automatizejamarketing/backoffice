import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
// @ts-expect-error Bun provides this test helper at runtime in this repository.
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { isVindiProductsEnabled, isVindiSubscriptionsEnabled } =
  await import("./config");

const originalProducts = process.env.VINDI_PRODUCTS_ENABLED;
const originalSubscriptions = process.env.VINDI_SUBSCRIPTIONS_ENABLED;

afterEach(() => {
  if (originalProducts === undefined) delete process.env.VINDI_PRODUCTS_ENABLED;
  else process.env.VINDI_PRODUCTS_ENABLED = originalProducts;
  if (originalSubscriptions === undefined) {
    delete process.env.VINDI_SUBSCRIPTIONS_ENABLED;
  } else {
    process.env.VINDI_SUBSCRIPTIONS_ENABLED = originalSubscriptions;
  }
});

describe("isVindiProductsEnabled", () => {
  it("stays off when the rollout flag is unset", () => {
    delete process.env.VINDI_PRODUCTS_ENABLED;
    assert.equal(isVindiProductsEnabled(), false);
  });

  it("turns on only when the flag is the string true", () => {
    process.env.VINDI_PRODUCTS_ENABLED = "true";
    assert.equal(isVindiProductsEnabled(), true);
    process.env.VINDI_PRODUCTS_ENABLED = "1";
    assert.equal(isVindiProductsEnabled(), false);
  });
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
