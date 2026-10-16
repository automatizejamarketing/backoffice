import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMediaLibraryAuditEntry } from "./audit";

describe("buildMediaLibraryAuditEntry", () => {
  it("adição: novo valor = nome do arquivo", () => {
    assert.deepEqual(
      buildMediaLibraryAuditEntry({ action: "media_library_add", adminEmail: "ana@x.com", targetUserId: "u1", filename: "bolo.png" }),
      { adminEmail: "ana@x.com", targetUserId: "u1", action: "media_library_add", fieldName: "media_library", oldValue: null, newValue: "bolo.png", note: null },
    );
  });
  it("exclusão: valor antigo = nome, novo = excluída; e-mail cortado em 100", () => {
    const entry = buildMediaLibraryAuditEntry({ action: "media_library_delete", adminEmail: `${"a".repeat(120)}@x.com`, targetUserId: "u1", filename: "  " });
    assert.equal(entry.oldValue, "mídia");
    assert.equal(entry.newValue, "excluída");
    assert.equal(entry.adminEmail.length, 100);
  });
});
