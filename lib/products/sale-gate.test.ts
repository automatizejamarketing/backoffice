import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProductOfferedForSale } from "./sale-gate";

describe("isProductOfferedForSale", () => {
  it("is à venda when published and sales are enabled", () => {
    assert.equal(
      isProductOfferedForSale({ status: "published", salesEnabled: true }),
      true,
    );
  });

  it("is not à venda when sales are disabled", () => {
    assert.equal(
      isProductOfferedForSale({ status: "published", salesEnabled: false }),
      false,
    );
  });

  it("is not à venda while still a draft", () => {
    assert.equal(
      isProductOfferedForSale({ status: "draft", salesEnabled: true }),
      false,
    );
  });

  it("is not à venda when archived", () => {
    assert.equal(
      isProductOfferedForSale({ status: "archived", salesEnabled: true }),
      false,
    );
  });
});
