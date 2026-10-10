import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { MCP_CAPABILITIES } from "./connections";

// Any database or Meta access in these tests is a bug: scope is decided before IO.
const forbidden = new Proxy({}, { get() { throw new Error("unexpected IO"); } });
mock.module("server-only", () => ({}));
mock.module("@/lib/db", () => ({ db: forbidden, postgresClient: forbidden }));

let resolveConsultantScope: typeof import("./meta-ads-queries").resolveConsultantScope;
let tools: typeof import("./meta-ads-tools").META_ADS_TOOLS;
let whatsappTools: typeof import("./whatsapp-campaign-tools").WHATSAPP_CAMPAIGN_TOOLS;
let batchTools: typeof import("./meta-batch-tools").META_BATCH_TOOLS;
before(async () => {
  ({ resolveConsultantScope } = await import("./meta-ads-queries"));
  ({ META_ADS_TOOLS: tools } = await import("./meta-ads-tools"));
  ({ WHATSAPP_CAMPAIGN_TOOLS: whatsappTools } = await import("./whatsapp-campaign-tools"));
  ({ META_BATCH_TOOLS: batchTools } = await import("./meta-batch-tools"));
});

const actor = (role: BackofficeActor["role"], assignedUserIds?: string[]): BackofficeActor =>
  ({ id: `${role}-id`, email: `${role}@x.com`, role, source: "database", assignedUserIds });
const tool = (name: string) => tools.find(t => t.name === name)!;
const assigned = "11111111-1111-4111-8111-111111111111";
const ctx = { origin: "https://backoffice.test" };
const other = "22222222-2222-4222-8222-222222222222";

describe("Meta Ads MCP scope", () => {
  it("pins a consultant to their own portfolio, even when asking for another consultant", async () => {
    assert.equal(await resolveConsultantScope(actor("marketing_consultant"), "chefe@x.com"), "marketing_consultant-id");
    assert.equal(await resolveConsultantScope(actor("marketing_consultant_premium")), null);
    assert.equal(await resolveConsultantScope(actor("admin")), null);
    await assert.rejects(resolveConsultantScope(actor("dev"), "fulano@x.com"), /Só admin/);
  });

  it("blocks a consultant from reading a client outside the portfolio", async () => {
    const consultant = actor("marketing_consultant", [assigned]);
    await assert.rejects(tool("get_client_campaigns").run(consultant, { userId: other }, ctx), /não está na sua carteira/);
    await assert.rejects(tool("list_portfolio_alerts").run(consultant, { userId: other }, ctx), /não está na sua carteira/);
  });

  it("exposes only read-only tools gated by marketing:read", () => {
    assert.deepEqual(tools.map(t => t.name).sort(), ["get_client_campaigns", "list_my_clients", "list_portfolio_alerts", "portfolio_performance"]);
    for (const t of tools) {
      assert.equal(t.write, false, t.name);
      assert.equal(t.permission, "marketing:read", t.name);
    }
  });

  it("describes on the Claude page exactly the permissions the tools check", () => {
    const toolPermissions = new Set([...tools, ...whatsappTools, ...batchTools].map(t => t.permission));
    assert.deepEqual([...toolPermissions].sort(), MCP_CAPABILITIES.map(c => c.permission).sort());
  });

  it("refuses a batch with a client outside the portfolio before any IO; no tool executes a batch", async () => {
    const consultant = actor("marketing_consultant", [assigned]);
    const preview = batchTools.find(t => t.name === "preview_meta_batch")!;
    await assert.rejects(
      preview.run(consultant, { note: "pausa geral", items: [{ userId: other, level: "campaign", id: "123", action: "pause" }] }, ctx),
      /Fora da sua carteira/,
    );
    // Só a aprovação no backoffice, na sessão da pessoa, executa um lote.
    assert.deepEqual(batchTools.map(t => t.name).sort(), ["get_meta_batch", "preview_meta_batch"]);
    assert.ok(batchTools.every(t => !t.write));
    assert.ok(batchTools.every(t => t.permission === "marketing:write"));
  });
});
