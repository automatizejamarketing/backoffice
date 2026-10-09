import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKOFFICE_ROLE_VALUES, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { appLabel, canDisconnect, capabilitiesFor, claudeCodeCommand, claudeConnectorLink, consentItems, MCP_CAPABILITIES, MCP_PAGE_PERMISSION, mcpServerUrl, providerOf } from "./connections";

const actor = (role: BackofficeActor["role"], email = `${role}@x.com`): BackofficeActor => ({ id: `${role}-id`, email, role, source: "database" });

describe("MCP connections page", () => {
  it("is open to every role that can use a tool, and to nobody else", () => {
    for (const role of BACKOFFICE_ROLE_VALUES) {
      const usesTools = MCP_CAPABILITIES.some((c) => hasBackofficePermission(actor(role), c.permission));
      assert.equal(hasBackofficePermission(actor(role), MCP_PAGE_PERMISSION), usesTools, role);
    }
  });

  it("lets a person disconnect their own apps and only team managers disconnect someone else's", () => {
    assert.equal(canDisconnect(actor("marketing_consultant", "Ana@x.com"), "ana@x.com "), true);
    assert.equal(canDisconnect(actor("marketing_consultant", "ana@x.com"), "bia@x.com"), false);
    assert.equal(canDisconnect(actor("dev"), "bia@x.com"), false);
    assert.equal(canDisconnect(actor("admin"), "bia@x.com"), true);
    assert.equal(canDisconnect(actor("finance_viewer"), "finance_viewer@x.com"), false);
  });

  it("shows only the capabilities the person has", () => {
    assert.deepEqual(capabilitiesFor(actor("marketing_consultant")).map((c) => c.permission), ["marketing:read"]);
    assert.deepEqual(capabilitiesFor(actor("admin")).map((c) => c.permission), ["marketing:read", "whatsapp:campaigns"]);
  });

  it("builds the connector address, the Claude link and the Claude Code command", () => {
    const url = mcpServerUrl("https://backoffice.automatizemarketing.com/");
    assert.equal(url, "https://backoffice.automatizemarketing.com/api/mcp");
    const link = new URL(claudeConnectorLink(url));
    assert.equal(link.searchParams.get("connectorUrl"), url);
    assert.equal(link.searchParams.get("connectorName"), "Backoffice Automatize");
    assert.equal(claudeCodeCommand(url), `claude mcp add --transport http backoffice-automatize ${url}`);
  });

  it("promises on the consent screen only what the role can do, and writes only with the write scope", () => {
    assert.deepEqual(consentItems(actor("marketing_consultant"), true), ["Consultar Meta Ads, resultados e alertas dos clientes que você acompanha"]);
    const adminRead = consentItems(actor("admin"), false);
    assert.equal(adminRead.length, 2);
    assert.ok(consentItems(actor("admin"), true).some((item) => item.startsWith("Agendar envios")));
    assert.ok(!adminRead.some((item) => item.startsWith("Agendar envios")));
    assert.deepEqual(consentItems(actor("finance_viewer"), true), []);
  });

  it("recognizes the assistant from the registered client name", () => {
    assert.equal(providerOf("Claude"), "claude");
    assert.equal(providerOf("claude-code (backoffice-automatize)"), "claude");
    assert.equal(providerOf("ChatGPT"), "chatgpt");
    assert.equal(providerOf("OpenAI Connector"), "chatgpt");
    assert.equal(providerOf("MCP Inspector"), null);
    assert.equal(appLabel("claude-code (backoffice-automatize)"), "Claude Code");
    assert.equal(appLabel("Claude Code"), "Claude Code");
    assert.equal(appLabel("Claude"), "Claude");
    assert.equal(appLabel("ChatGPT Connector"), "ChatGPT");
    assert.equal(appLabel("MCP Inspector"), "MCP Inspector");
  });
});
