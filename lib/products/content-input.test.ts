import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductContentInput } from "./content-input";

describe("product content input", () => {
  it("accepts private files without a public source URL", () => {
    const parsed = parseProductContentInput({
      productId: "00000000-0000-4000-8000-000000000001",
      type: "pdf",
      title: "Material",
      blobPathname: "products/material.pdf",
      position: 1,
    });
    assert.equal(parsed.sourceUrl, null);
    assert.equal(parsed.blobPathname, "products/material.pdf");
  });

  it("rejects unsafe external links", () => {
    assert.throws(
      () =>
        parseProductContentInput({
          productId: "00000000-0000-4000-8000-000000000001",
          type: "external_link",
          title: "Material",
          sourceUrl: "javascript:alert(1)",
          position: 1,
        }),
      /HTTPS/,
    );
  });
});
