import { describe, expect, test } from "bun:test";
import { orderMatchesBuyerSearch } from "./product-order-search";

const order = {
  buyerName: "Gunther Duarte",
  buyerEmail: "gunther.duarte1@gmail.com",
};

describe("orderMatchesBuyerSearch", () => {
  test("empty query keeps every order", () => {
    expect(orderMatchesBuyerSearch(order, "")).toBe(true);
    expect(orderMatchesBuyerSearch(order, "   ")).toBe(true);
  });

  test("matches name without regard to case", () => {
    expect(orderMatchesBuyerSearch(order, "gunther")).toBe(true);
    expect(orderMatchesBuyerSearch(order, "DUARTE")).toBe(true);
  });

  test("matches email without regard to case", () => {
    expect(orderMatchesBuyerSearch(order, "Gunther.Duarte1@gmail.com")).toBe(
      true,
    );
  });

  test("rejects unrelated name or email", () => {
    expect(orderMatchesBuyerSearch(order, "ramon")).toBe(false);
    expect(orderMatchesBuyerSearch(order, "rsfiorese@live.com")).toBe(false);
  });
});
