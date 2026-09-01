import { describe, it } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Bun provides this test helper at runtime in this repository.
import { mock } from "bun:test";
import type { VindiClient } from "./client";

mock.module("server-only", () => ({}));

const { getVindiSettlementByChargeId } = await import("./settlement-lookup");

function fakeClient(
  handler: (request: { method: string; path: string }) => Promise<unknown>,
): VindiClient {
  return { request: handler as VindiClient["request"] };
}

describe("getVindiSettlementByChargeId", () => {
  it("returns settled amounts from GET /v1/charges/:id", async () => {
    const seen: Array<{ method: string; path: string }> = [];
    const client = fakeClient(async (request) => {
      seen.push({ method: request.method, path: request.path });
      return {
        charge: {
          id: 88002,
          amount: "297.00",
          status: "paid",
          net_amount: "283.53",
          fee_amount: "13.47",
        },
      };
    });

    const settled = await getVindiSettlementByChargeId("88002", client);

    assert.deepEqual(seen, [{ method: "GET", path: "/v1/charges/88002" }]);
    assert.deepEqual(settled, {
      grossAmount: 29_700,
      netAmount: 28_353,
      feeAmount: 1_347,
    });
  });

  it("returns null when the charge has no net yet, without throwing", async () => {
    const client = fakeClient(async () => ({
      charge: { id: 1, amount: "297.00", status: "paid" },
    }));

    assert.equal(await getVindiSettlementByChargeId("1", client), null);
  });

  it("returns null when the request fails, without throwing", async () => {
    const client = fakeClient(async () => {
      throw new Error("vindi is down");
    });

    assert.equal(await getVindiSettlementByChargeId("1", client), null);
  });
});
