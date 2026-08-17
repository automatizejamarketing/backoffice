import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
// @ts-expect-error Bun provides this test helper at runtime in this repository.
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { isVindiProductsEnabled } = await import("./config");

const original = process.env.VINDI_PRODUCTS_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.VINDI_PRODUCTS_ENABLED;
  else process.env.VINDI_PRODUCTS_ENABLED = original;
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
