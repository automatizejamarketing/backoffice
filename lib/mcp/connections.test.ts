import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKOFFICE_ROLE_VALUES, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { canDisconnect, capabilitiesFor, claudeCodeCommand, claudeConnectorLink, connectionKey, consentItems, identifyClient, MCP_CAPABILITIES, MCP_PAGE_PERMISSION, mcpServerUrl, visibleConnections } from "./connections";

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
    assert.deepEqual(capabilitiesFor(actor("marketing_consultant")).map((c) => c.permission), ["marketing:read", "marketing:write"]);
    assert.deepEqual(capabilitiesFor(actor("admin")).map((c) => c.permission), ["marketing:read", "marketing:write", "whatsapp:campaigns"]);
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
    assert.deepEqual(consentItems(actor("marketing_consultant"), true), [
      "Consultar Meta Ads, resultados e alertas dos clientes que você acompanha",
      "Preparar pausas, ativações e mudanças de orçamento diário, que só rodam depois que você aprovar no backoffice",
    ]);
    const adminRead = consentItems(actor("admin"), false);
    assert.equal(adminRead.length, 3);
    assert.ok(consentItems(actor("admin"), true).some((item) => item.startsWith("Agendar envios")));
    assert.ok(!adminRead.some((item) => item.startsWith("Agendar envios")));
    assert.deepEqual(consentItems(actor("finance_viewer"), true), []);
  });

  it("brands a client as Claude or ChatGPT only when its redirect goes to their domain", () => {
    assert.deepEqual(identifyClient("Claude", ["https://claude.ai/api/mcp/auth_callback"]), { provider: "claude", label: "Claude", local: false });
    assert.deepEqual(identifyClient("ChatGPT", ["https://chatgpt.com/connector_platform_oauth_redirect"]), { provider: "chatgpt", label: "ChatGPT", local: false });
    // A self-registered name is a claim: another domain keeps its own name and no official mark.
    assert.deepEqual(identifyClient("Untrusted third-party Claude bridge", ["https://attacker.example/callback"]), { provider: null, label: "Untrusted third-party Claude bridge", local: false });
    assert.equal(identifyClient("Claude", ["https://claude.ai/cb", "https://attacker.example/cb"]).provider, null);
    assert.equal(identifyClient("Claude", ["https://claude.ai.attacker.example/cb"]).provider, null);
    assert.equal(identifyClient("Claude", ["not a url"]).provider, null);
    assert.deepEqual(identifyClient("claude-code (backoffice-automatize)", ["http://localhost:53682/callback"]), { provider: null, label: "claude-code (backoffice-automatize)", local: true });
  });

  it("keeps a disconnected row hidden until that pair connects again", () => {
    const row = { actorEmail: "a@x.com", clientId: "c1", lastActivityAt: "2026-10-09T15:00:00.000Z" };
    const other = { ...row, clientId: "c2" };
    const hidden = { [connectionKey(row)]: row.lastActivityAt };
    assert.deepEqual(visibleConnections([row, other], hidden), [other]);
    // Reconnected after the click: newer activity shows again on the next refresh.
    const again = { ...row, lastActivityAt: "2026-10-09T16:00:00.000Z" };
    assert.deepEqual(visibleConnections([again, other], hidden), [again, other]);
  });
});
