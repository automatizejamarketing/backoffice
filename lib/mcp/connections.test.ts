import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKOFFICE_ROLE_VALUES, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { canDisconnect, capabilitiesFor, claudeCodeCommand, claudeConnectorLink, MCP_CAPABILITIES, MCP_PAGE_PERMISSION, mcpServerUrl } from "./connections";

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
});
