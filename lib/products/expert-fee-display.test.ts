import { describe, expect, test } from "bun:test";
import {
  calculateExpertPlatformFeeCentavos,
  formatExpertPlatformFee,
  formatExpertPlatformFeePreview,
} from "./expert-fee-display";

describe("expert platform fee display", () => {
  test("formats the configured percentage and fixed fee", () => {
    expect(formatExpertPlatformFee(549, 39)).toBe("5,49% + R$ 0,39");
  });

  test("calculates and previews the fee charged on a R$ 100 sale", () => {
    expect(calculateExpertPlatformFeeCentavos(10_000, 549, 39)).toBe(588);
    expect(formatExpertPlatformFeePreview(549, 39)).toBe(
      "Em uma venda de R$ 100,00, a taxa é R$ 5,88.",
    );
  });

  test("caps the fee at the gross amount", () => {
    expect(calculateExpertPlatformFeeCentavos(20, 549, 39)).toBe(20);
  });
});
