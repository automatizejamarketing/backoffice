import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  getMediaPublicUrl,
  isMediaR2Configured,
  mediaUrlToKey,
} from "./media-r2";

const ORIGINAL_BASE = process.env.MEDIA_PUBLIC_BASE_URL;
process.env.MEDIA_PUBLIC_BASE_URL = "https://media.automatizemarketing.com";

after(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
  else process.env.MEDIA_PUBLIC_BASE_URL = ORIGINAL_BASE;
});

describe("media-r2 URLs", () => {
  it("gera URL pública a partir da chave, com e sem o prefixo media/", () => {
    assert.equal(
      getMediaPublicUrl("media/posts/abc-123.png"),
      "https://media.automatizemarketing.com/media/posts/abc-123.png",
    );
    assert.equal(
      getMediaPublicUrl("posts/abc-123.png"),
      "https://media.automatizemarketing.com/media/posts/abc-123.png",
    );
  });

  it("faz o round-trip URL → chave", () => {
    const key = "media/posts/abc-123.png";
    assert.equal(mediaUrlToKey(getMediaPublicUrl(key)), key);
  });

  it("aceita URL relativa e o formato v1 (/api/media) legado", () => {
    assert.equal(
      mediaUrlToKey("/media/posts/abc-123.png"),
      "media/posts/abc-123.png",
    );
    assert.equal(
      mediaUrlToKey("/api/media/posts/abc-123.png"),
      "media/posts/abc-123.png",
    );
  });

  it("ignora URLs legadas do Vercel Blob (não são deste storage)", () => {
    assert.equal(
      mediaUrlToKey(
        "https://piostivtjjqwpdmk.public.blob.vercel-storage.com/posts/x.png",
      ),
      null,
    );
  });

  it("recusa path traversal e lixo", () => {
    assert.equal(mediaUrlToKey("/media/../../etc/passwd"), null);
    assert.equal(mediaUrlToKey("/media/"), null);
    assert.equal(mediaUrlToKey("não é url"), null);
  });
});

describe("media-r2 configuração", () => {
  const valid = {
    NODE_ENV: "production",
    CLOUDFLARE_R2_ACCOUNT_ID: "acct",
    PRODUCT_ASSETS_R2_BUCKET: "bucket",
    PRODUCT_ASSETS_R2_ACCESS_KEY_ID: "0123456789abcdef0123",
    PRODUCT_ASSETS_R2_SECRET_ACCESS_KEY: "0123456789abcdef0123",
  } as unknown as NodeJS.ProcessEnv;

  it("exige MEDIA_R2_BUCKET — bucket de product assets não é fallback", () => {
    assert.equal(isMediaR2Configured(valid), false);
    assert.equal(
      isMediaR2Configured({
        ...valid,
        MEDIA_R2_BUCKET: "automatize-media-prod",
      } as NodeJS.ProcessEnv),
      true,
    );
  });

  it("trata valores mascarados/curtos como não configurado", () => {
    assert.equal(
      isMediaR2Configured({
        ...valid,
        PRODUCT_ASSETS_R2_ACCESS_KEY_ID: "[SENSITIVE]",
      } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isMediaR2Configured({
        ...valid,
        MEDIA_R2_BUCKET: "automatize-media-prod",
        PRODUCT_ASSETS_R2_ACCESS_KEY_ID: "curta",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  it("prefere as credenciais dedicadas MEDIA_R2_* quando existem", () => {
    assert.equal(
      isMediaR2Configured({
        NODE_ENV: "production",
        CLOUDFLARE_R2_ACCOUNT_ID: "acct",
        MEDIA_R2_BUCKET: "media-bucket",
        MEDIA_R2_ACCESS_KEY_ID: "0123456789abcdef0123",
        MEDIA_R2_SECRET_ACCESS_KEY: "0123456789abcdef0123",
      } as unknown as NodeJS.ProcessEnv),
      true,
    );
  });
});
