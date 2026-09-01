import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVindiPixQrBillRequest,
  quoteBackofficeVindiPixAmount,
} from "./subscription-pix-qr";

describe("buildVindiPixQrBillRequest", () => {
  it("charges the legado-style period total as a standalone Pix bill", () => {
    assert.equal(quoteBackofficeVindiPixAmount("quarterly_starter"), 80100);

    const body = buildVindiPixQrBillRequest({
      customerId: 873101,
      productId: 31012,
      pixMethodCode: "pix_from_account",
      appUserId: "user-1",
      planType: "quarterly_starter",
    });

    assert.equal(body.payment_method_code, "pix_from_account");
    assert.deepEqual(body.bill_items, [
      {
        product_id: 31012,
        amount: "801.00",
        description: "Starter Trimestral",
      },
    ]);
    assert.deepEqual(body.metadata, {
      purpose: "subscription",
      payment_method: "pix_qr",
      app_user_id: "user-1",
      plan_type: "quarterly_starter",
    });
  });

  it("refuses a blank Pix method code from the account", () => {
    assert.throws(
      () =>
        buildVindiPixQrBillRequest({
          customerId: 1,
          productId: 2,
          pixMethodCode: "  ",
          appUserId: "user-1",
          planType: "monthly_pro",
        }),
      /Pix payment method code is required/,
    );
  });
});
