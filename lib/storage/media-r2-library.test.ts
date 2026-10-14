import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttachmentContentDisposition,
  collectListedKeys,
  deleteKeysInBatches,
  deleteMediaObjectKeysReportingErrors,
  normalizeListPrefix,
  resolveMediaR2ClientOptions,
  splitMediaDeleteKeys,
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

describe("deleteKeysInBatches", () => {
  it("Errors por chave viram failed e ficam fora de deletedKeys", async () => {
    const result = await deleteKeysInBatches(["media/a.png", "media/b.png"], async () => ({
      Errors: [{ Key: "media/b.png", Code: "AccessDenied", Message: "Access Denied" }],
    }));
    assert.deepEqual(result, {
      deletedKeys: ["media/a.png"],
      failed: [{ key: "media/b.png", message: "Access Denied" }],
    });
  });

  it("sem Message usa Code; sem Message nem Code usa delete_failed", async () => {
    const result = await deleteKeysInBatches(["media/a.png", "media/b.png", "media/c.png"], async () => ({
      Errors: [{ Key: "media/a.png", Code: "InternalError" }, { Key: "media/b.png" }],
    }));
    assert.deepEqual(result, {
      deletedKeys: ["media/c.png"],
      failed: [
        { key: "media/a.png", message: "InternalError" },
        { key: "media/b.png", message: "delete_failed" },
      ],
    });
  });

  it("Errors sem Key não conta como sucesso: o lote inteiro vai para failed", async () => {
    const result = await deleteKeysInBatches(["media/a.png", "media/b.png"], async () => ({
      Errors: [{ Code: "InternalError", Message: "boom" }],
    }));
    assert.deepEqual(result, {
      deletedKeys: [],
      failed: [
        { key: "media/a.png", message: "boom" },
        { key: "media/b.png", message: "boom" },
      ],
    });
  });

  it("lote que lança falha inteiro e os demais lotes seguem", async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `media/k${i}.png`);
    let call = 0;
    const result = await deleteKeysInBatches(keys, async () => {
      call += 1;
      if (call === 1) throw new Error("network down");
      return {};
    });
    assert.deepEqual(result.failed.map((entry) => entry.key), keys.slice(0, 1000));
    assert.ok(result.failed.every((entry) => entry.message === "network down"));
    assert.deepEqual(result.deletedKeys, ["media/k1000.png"]);
  });

  it("erro que não é Error vira delete_failed", async () => {
    const result = await deleteKeysInBatches(["media/a.png"], async () => {
      throw "boom";
    });
    assert.deepEqual(result, {
      deletedKeys: [],
      failed: [{ key: "media/a.png", message: "delete_failed" }],
    });
  });

  it("1001 chaves viram exatamente dois lotes, de 1000 e de 1", async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `media/k${i}.png`);
    const sizes: number[] = [];
    const result = await deleteKeysInBatches(keys, async (batch) => {
      sizes.push(batch.length);
      return {};
    });
    assert.deepEqual(sizes, [1000, 1]);
    assert.equal(result.deletedKeys.length, 1001);
    assert.deepEqual(result.failed, []);
  });
});

describe("splitMediaDeleteKeys", () => {
  it("deduplica e separa chaves inválidas (.. ou só o prefixo) como invalid_media_key", () => {
    assert.deepEqual(
      splitMediaDeleteKeys(["media/a.png", "a.png", "media/", "", "media/../x.png", "../y.png"]),
      {
        keys: ["media/a.png"],
        invalid: [
          { key: "media/", message: "invalid_media_key" },
          { key: "media/../x.png", message: "invalid_media_key" },
          { key: "media/../y.png", message: "invalid_media_key" },
        ],
      },
    );
  });
});

describe("deleteMediaObjectKeysReportingErrors", () => {
  it("chave inválida nunca some: sem nenhuma chave válida, volta em failed", async () => {
    assert.deepEqual(await deleteMediaObjectKeysReportingErrors(["media/../x.png", "media/"]), {
      deletedKeys: [],
      failed: [
        { key: "media/../x.png", message: "invalid_media_key" },
        { key: "media/", message: "invalid_media_key" },
      ],
    });
  });
});

describe("collectListedKeys", () => {
  it("segue NextContinuationToken e concatena todas as páginas", async () => {
    const tokens: (string | undefined)[] = [];
    const keys = await collectListedKeys(async (token) => {
      tokens.push(token);
      if (token === undefined) {
        return {
          Contents: [{ Key: "media/a.png" }, { Key: "media/b.png" }],
          IsTruncated: true,
          NextContinuationToken: "t1",
        };
      }
      return { Contents: [{ Key: "media/c.png" }], IsTruncated: false };
    });
    assert.deepEqual(tokens, [undefined, "t1"]);
    assert.deepEqual(keys, ["media/a.png", "media/b.png", "media/c.png"]);
  });

  it("entrada sem Key e página sem Contents não quebram a listagem", async () => {
    assert.deepEqual(await collectListedKeys(async () => ({})), []);
    assert.deepEqual(
      await collectListedKeys(async () => ({ Contents: [{}, { Key: "media/a.png" }] })),
      ["media/a.png"],
    );
  });
});

describe("normalizeListPrefix", () => {
  it("acrescenta a barra final, então u1 não casa u10", () => {
    assert.equal(normalizeListPrefix("media/library/u1"), "media/library/u1/");
    assert.equal(normalizeListPrefix("library/u1"), "media/library/u1/");
    assert.equal(normalizeListPrefix("media/library/u1/"), "media/library/u1/");
    assert.equal("media/library/u10/x.png".startsWith(normalizeListPrefix("media/library/u1")), false);
    assert.equal("media/library/u1/x.png".startsWith(normalizeListPrefix("media/library/u1")), true);
  });

  it("rejeita prefixo vazio, só o prefixo ou com ..", () => {
    assert.throws(() => normalizeListPrefix(""), /invalid_media_prefix/);
    assert.throws(() => normalizeListPrefix("media/"), /invalid_media_prefix/);
    assert.throws(() => normalizeListPrefix("library/../x"), /invalid_media_prefix/);
  });
});

describe("buildAttachmentContentDisposition sem controles bidi", () => {
  it("nunca leva U+202E para o cabeçalho, nem em filename nem em filename*", () => {
    const header = buildAttachmentContentDisposition("foto\u202Egnp.exe");
    assert.equal(header.includes("\u202E"), false);
    assert.equal(header.includes("%E2%80%AE"), false);
    assert.equal(header, "attachment; filename=\"fotognp.exe\"; filename*=UTF-8''fotognp.exe");
  });
});
