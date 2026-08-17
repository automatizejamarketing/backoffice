import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSettledVindiAmounts,
  getVindiSettlementAmounts,
  unwrapVindiCharge,
} from "./settlement";

describe("getSettledVindiAmounts", () => {
  it("reads integer centavos that add up when the charge publishes net and fee", () => {
    const settled = getSettledVindiAmounts({
      id: 88002,
      amount: "297.00",
      status: "paid",
      net_amount: "283.53",
      fee_amount: "13.47",
    });

    assert.deepEqual(settled, {
      grossAmount: 29_700,
      netAmount: 28_353,
      feeAmount: 1_347,
    });
    assert.equal(settled!.grossAmount - settled!.feeAmount!, settled!.netAmount);
  });

  it("returns nothing while the API has not published a net or a fee", () => {
    assert.equal(
      getSettledVindiAmounts({
        id: 88002,
        amount: "297.00",
        status: "paid",
      }),
      null,
    );
  });

  it("derives net from an explicit fee so the reconciler can finish the row", () => {
    assert.deepEqual(
      getSettledVindiAmounts({
        id: 1,
        amount: "297.00",
        status: "paid",
        fee_amount: "13.47",
      }),
      { grossAmount: 29_700, netAmount: 28_353, feeAmount: 1_347 },
    );
  });

  it("keeps a settled charge whose fee the gateway did not itemize", () => {
    assert.deepEqual(
      getSettledVindiAmounts({
        id: 1,
        amount: "297.00",
        status: "paid",
        net_amount: "297.00",
      }),
      { grossAmount: 29_700, netAmount: 29_700, feeAmount: null },
    );
  });

  it("reads net and fee from last_transaction.gateway_response_fields", () => {
    assert.deepEqual(
      getSettledVindiAmounts({
        id: 1,
        amount: "100.00",
        status: "paid",
        last_transaction: {
          status: "success",
          gateway_response_fields: {
            net_amount: "94.51",
            fee_amount: "5.49",
          },
        },
      }),
      { grossAmount: 10_000, netAmount: 9_451, feeAmount: 549 },
    );
  });
});

describe("getVindiSettlementAmounts", () => {
  it("keeps net and fee nullable when Vindi omits settlement data", () => {
    assert.deepEqual(
      getVindiSettlementAmounts({
        id: 1,
        amount: "10.00",
        status: "paid",
      }),
      { grossAmount: 1_000, netAmount: null, feeAmount: null },
    );
  });

  it("reads a numeric amount the same way as a decimal string", () => {
    assert.deepEqual(
      getVindiSettlementAmounts({
        id: 1,
        amount: 150,
        status: "paid",
        net_amount: 147.01,
        fee_amount: 2.99,
      }),
      { grossAmount: 15_000, netAmount: 14_701, feeAmount: 299 },
    );
  });
});

describe("unwrapVindiCharge", () => {
  it("accepts the GET /v1/charges/:id wrapper and a bare charge", () => {
    const charge = {
      id: 42,
      amount: "10.00",
      status: "paid",
      net_amount: "9.00",
      fee_amount: "1.00",
    };

    assert.deepEqual(unwrapVindiCharge({ charge }), charge);
    assert.deepEqual(unwrapVindiCharge(charge), charge);
    assert.equal(unwrapVindiCharge(null), null);
    assert.equal(unwrapVindiCharge({}), null);
  });
});
