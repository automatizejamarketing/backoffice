import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductRefundCheckoutSummary,
  getProductRefundRootOrderId,
  parseRefundBumpOrderIds,
} from "./refund-scope";

describe("backoffice integral refund scope", () => {
  it("normalizes a directly selected bump", () => {
    assert.equal(
      getProductRefundRootOrderId({
        id: "bump",
        attribution: {
          order_bump: "true",
          order_bump_parent_order_id: "root",
        },
      }),
      "root",
    );
  });

  it("builds one amount and one item list for the whole checkout", () => {
    assert.deepEqual(
      buildProductRefundCheckoutSummary(
        { id: "root", productTitle: "Curso", priceCentavos: 1000 },
        [{ id: "bump", productTitle: "Bônus", priceCentavos: 200 }],
      ),
      {
        orderIds: ["root", "bump"],
        items: [
          { orderId: "root", title: "Curso", amountCentavos: 1000 },
          { orderId: "bump", title: "Bônus", amountCentavos: 200 },
        ],
        totalCentavos: 1200,
      },
    );
  });

  it("does not trust malformed bump lists", () => {
    assert.deepEqual(parseRefundBumpOrderIds("a,a,b"), ["a", "b"]);
  });
});
