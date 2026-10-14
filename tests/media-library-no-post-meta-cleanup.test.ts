import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Biblioteca de mídias: só exclusão explícita e retenção apagam mídia", () => {
  it("o apagador pós-ingestão da Meta não existe mais", () => {
    assert.equal(existsSync(join(root, "lib/meta-business/marketing/cleanup-blob-after-meta.ts")), false);
  });
  it("as rotas de anúncio não chamam mais o apagador", () => {
    for (const path of [
      "app/api/meta-marketing/[accountId]/ads/[adId]/creative/route.ts",
      "app/api/meta-marketing/[accountId]/adsets/[adsetId]/ads/route.ts",
    ]) {
      assert.doesNotMatch(readFileSync(join(root, path), "utf8"), /cleanupBlobAfterMetaIngestion/);
    }
  });
});
