import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttachmentContentDisposition,
  resolveMediaR2ClientOptions,
} from "./media-r2";

describe("resolveMediaR2ClientOptions", () => {
  it("usa o endpoint da conta R2 por padrão", () => {
    assert.deepEqual(resolveMediaR2ClientOptions("abc123", { NODE_ENV: "test" }), {
      endpoint: "https://abc123.r2.cloudflarestorage.com",
      forcePathStyle: false,
    });
  });
  it("MEDIA_R2_ENDPOINT troca o endpoint e liga path-style (S3 local)", () => {
    assert.deepEqual(
      resolveMediaR2ClientOptions("abc123", { NODE_ENV: "test", MEDIA_R2_ENDPOINT: " http://localhost:4566 " }),
      { endpoint: "http://localhost:4566", forcePathStyle: true },
    );
  });
});

describe("buildAttachmentContentDisposition", () => {
  it("mantém o nome original em UTF-8 e um fallback ASCII", () => {
    assert.equal(
      buildAttachmentContentDisposition("Pão de queijo (1).jpg"),
      `attachment; filename="Pao de queijo (1).jpg"; filename*=UTF-8''P%C3%A3o%20de%20queijo%20%281%29.jpg`,
    );
  });
  it("neutraliza aspas, barras e emoji no fallback", () => {
    assert.equal(
      buildAttachmentContentDisposition('a"b\\c🧀.png'),
      `attachment; filename="a_b_c__.png"; filename*=UTF-8''a%22b%5Cc%F0%9F%A7%80.png`,
    );
  });
  it("nome vazio vira midia", () => {
    assert.match(buildAttachmentContentDisposition("   "), /^attachment; filename="midia"/);
  });
});
