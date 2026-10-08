import assert from "node:assert/strict";
import test from "node:test";

import { formatPixelOption } from "./formatters";

test("formatPixelOption shows the pixel ID after its name", () => {
  assert.equal(
    formatPixelOption({ id: "1234567890123456", name: "La chapa B" }),
    "La chapa B (1234567890123456)",
  );
});

test("formatPixelOption falls back to the ID when the pixel has no usable name", () => {
  assert.equal(formatPixelOption({ id: "1234567890123456" }), "1234567890123456");
  assert.equal(formatPixelOption({ id: "1234567890123456", name: "" }), "1234567890123456");
  assert.equal(formatPixelOption({ id: "1234567890123456", name: "   " }), "1234567890123456");
  assert.equal(formatPixelOption({ id: "1234567890123456", name: null }), "1234567890123456");
});

test("formatPixelOption does not repeat the ID when Meta returns it as the name", () => {
  assert.equal(
    formatPixelOption({ id: "1234567890123456", name: "1234567890123456" }),
    "1234567890123456",
  );
});
