import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { normalizeOutreachBatch, type OutreachInput } from "@/lib/consultant-workspace/outreach-core";
import { batchConfirmationCode } from "./batch-confirmation";

// Escopo e confirmação são decididos antes de qualquer IO: banco e rede aqui são bug.
const forbidden = new Proxy({}, { get() { throw new Error("unexpected IO"); } });
mock.module("server-only", () => ({}));
mock.module("@/lib/db", () => ({ db: forbidden, postgresClient: forbidden }));

let tools: typeof import("./consultant-outreach-tools").CONSULTANT_OUTREACH_TOOLS;
const originalFetch = globalThis.fetch;
const originalSecret = process.env.AUTH_SECRET;
before(async () => {
  process.env.AUTH_SECRET = "test-secret";
  globalThis.fetch = (async () => {
    throw new Error("unexpected network call");
  }) as unknown as typeof fetch;
  ({ CONSULTANT_OUTREACH_TOOLS: tools } = await import("./consultant-outreach-tools"));
});
after(() => {
  globalThis.fetch = originalFetch;
  process.env.AUTH_SECRET = originalSecret;
});

const assigned = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const consultant: BackofficeActor = { id: "c-id", email: "gestor@x.com", role: "marketing_consultant", source: "database", assignedUserIds: [assigned] };
const tool = (name: string) => tools.find((t) => t.name === name)!;
const message: OutreachInput = { userId: assigned, kind: "creative_refresh", title: "fotos novas", message: "Oi! Manda 3 fotos?" };

describe("MCP · mensagens da Mat", () => {
  it("registra as quatro ferramentas, com envio marcado como escrita destrutiva", () => {
    assert.deepEqual(tools.map((t) => t.name), ["list_suggested_actions", "preview_mat_messages", "send_mat_messages", "suggest_offer"]);
    const send = tool("send_mat_messages");
    assert.equal(send.write, true);
    assert.equal(send.destructive, true);
    assert.equal(tool("preview_mat_messages").write, false);
  });

  it("não deixa o consultor mexer em cliente fora da carteira", async () => {
    await assert.rejects(tool("preview_mat_messages").run(consultant, { messages: [{ ...message, userId: other }] }), /carteira/);
    await assert.rejects(tool("list_suggested_actions").run(consultant, { userId: other }), /carteira/);
    await assert.rejects(tool("suggest_offer").run(consultant, { userId: other }), /carteira/);
  });

  it("recusa envio com código de outro lote, de outro segredo ou vencido — antes de chamar o app", async () => {
    const send = tool("send_mat_messages");
    const otherBatch = batchConfirmationCode(normalizeOutreachBatch([{ ...message, message: "outro texto" }]), "test-secret");
    await assert.rejects(send.run(consultant, { messages: [message], confirmationCode: otherBatch }), /mudaram desde a prévia/);
    const otherSecret = batchConfirmationCode(normalizeOutreachBatch([message]), "outro-segredo");
    await assert.rejects(send.run(consultant, { messages: [message], confirmationCode: otherSecret }), /mudaram desde a prévia/);
    const expired = batchConfirmationCode(normalizeOutreachBatch([message]), "test-secret", Date.now() - 16 * 60 * 1000);
    await assert.rejects(send.run(consultant, { messages: [message], confirmationCode: expired }), /expirou/);
  });

  it("valida o contrato na entrada (scale_approval sem campanha não passa)", async () => {
    await assert.rejects(
      async () => tool("preview_mat_messages").run(consultant, { messages: [{ ...message, kind: "scale_approval" }] }),
      /campanha/,
    );
  });
});
