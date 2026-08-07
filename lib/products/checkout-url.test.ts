import { describe, expect, test } from "bun:test";
import { buildProductCheckoutUrl } from "./checkout-url";

describe("buildProductCheckoutUrl", () => {
  test("builds the public checkout URL", () => {
    expect(
      buildProductCheckoutUrl(
        "https://www.automatizemarketing.com",
        "produto-do-jp",
      ),
    ).toBe("https://www.automatizemarketing.com/produtos/produto-do-jp");
  });

  test("removes trailing slashes and encodes the slug", () => {
    expect(
      buildProductCheckoutUrl("https://example.com///", "produto especial"),
    ).toBe("https://example.com/produtos/produto%20especial");
  });
});
