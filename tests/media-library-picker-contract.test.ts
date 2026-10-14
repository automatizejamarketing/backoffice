import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("seletor de mídia do backoffice", () => {
  it("a aba de dispositivo virou Biblioteca e usa o painel compartilhado", () => {
    const source = readFileSync(join(root, "app/(admin)/marketing/components/media-source-picker.tsx"), "utf8");
    assert.match(source, /MediaLibraryPanel/);
    assert.match(source, />Biblioteca</);
    assert.doesNotMatch(source, /DeviceUploadTab/);
  });
  it("o upload antigo saiu", () => {
    assert.equal(existsSync(join(root, "app/(admin)/marketing/components/device-upload-tab.tsx")), false);
    assert.equal(existsSync(join(root, "app/api/files/upload/route.ts")), false);
  });
});
