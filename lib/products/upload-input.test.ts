import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProductAssetObjectKey,
  parseProductUploadInput,
} from "./upload-input";

describe("product upload input", () => {
  it("accepts a raster cover image", () => {
    assert.deepEqual(
      parseProductUploadInput({
        kind: "cover",
        filename: "Capa principal.webp",
        contentType: "image/webp",
        size: 240_000,
      }),
      {
        kind: "cover",
        filename: "Capa principal.webp",
        contentType: "image/webp",
        size: 240_000,
        productId: null,
      },
    );
  });

  it("requires the product id for private content", () => {
    assert.throws(
      () =>
        parseProductUploadInput({
          kind: "content",
          filename: "material.pdf",
          contentType: "application/pdf",
          size: 240_000,
        }),
      /produto/i,
    );
  });

  it("rejects unsafe cover types and oversized files", () => {
    assert.throws(
      () =>
        parseProductUploadInput({
          kind: "cover",
          filename: "capa.svg",
          contentType: "image/svg+xml",
          size: 100,
        }),
      /formato/i,
    );
    assert.throws(
      () =>
        parseProductUploadInput({
          kind: "content",
          productId: "00000000-0000-4000-8000-000000000001",
          filename: "arquivo.zip",
          contentType: "application/zip",
          size: 50 * 1024 * 1024 + 1,
        }),
      /50 MB/i,
    );
  });

  it("creates a scoped object key with a safe filename", () => {
    assert.equal(
      createProductAssetObjectKey(
        {
          kind: "content",
          productId: "00000000-0000-4000-8000-000000000001",
          filename: "Plano / ação.pdf",
          contentType: "application/pdf",
          size: 100,
        },
        "00000000-0000-4000-8000-000000000002",
      ),
      "r2/products/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002-plano-acao.pdf",
    );
  });
});
