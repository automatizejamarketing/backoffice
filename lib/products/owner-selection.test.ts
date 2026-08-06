import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getProductOwnerSelectionValue,
  parseProductOwnerSelection,
} from "./owner-selection";

describe("product owner selection", () => {
  it("maps Automatize to an owner without expert", () => {
    assert.deepEqual(parseProductOwnerSelection("automatize"), {
      ownerType: "automatize",
      expertId: "",
    });
  });

  it("maps an expert option to the existing product contract", () => {
    assert.equal(
      getProductOwnerSelectionValue("expert", "expert-id"),
      "expert:expert-id",
    );
    assert.deepEqual(parseProductOwnerSelection("expert:expert-id"), {
      ownerType: "expert",
      expertId: "expert-id",
    });
  });
});
