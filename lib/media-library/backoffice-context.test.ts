import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBackofficeMediaLibraryContext } from "./backoffice-context-core";

const base = { id: "a1", source: "database" as const };

describe("buildBackofficeMediaLibraryContext", () => {
  it("admin escreve em qualquer cliente", () => {
    const ctx = buildBackofficeMediaLibraryContext({ ...base, email: "adm@x.com", role: "admin" }, "u1");
    assert.deepEqual(ctx, { userId: "u1", actor: { kind: "backoffice", email: "adm@x.com" }, viewer: { canWrite: true } });
  });
  it("consultor só escreve no cliente atribuído", () => {
    const consultant = { ...base, email: "c@x.com", role: "marketing_consultant" as const, assignedUserIds: ["u1"] };
    assert.equal(buildBackofficeMediaLibraryContext(consultant, "u1").viewer?.canWrite, true);
    assert.equal(buildBackofficeMediaLibraryContext(consultant, "u2").viewer?.canWrite, false);
  });
});
