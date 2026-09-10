import { describe, expect, test } from "bun:test";
import { apportionPostSaleCosts } from "./post-sale-cost-settlement";

describe("post-sale cost settlement", () => {
  test("rounds an exact half-cent down for the Expert under R17", () => {
    const result = apportionPostSaleCosts({
      reversal: "integral_refund",
      items: [{ orderId: "order-1", commercialPriceCentavos: 100, expertShareBasisPoints: 5_000 }],
      movements: [{ id: "movement-1", kind: "cost", attribution: "specific", orderId: "order-1", amountCentavos: 1, supportedBy: "automatize" }],
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.items[0]?.expertResponsibilityCentavos).toBe(0);
  });
});
