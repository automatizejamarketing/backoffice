import { headers } from "next/headers";
import { requirePagePermission } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { capabilitiesFor, MCP_PAGE_PERMISSION, mcpServerUrl } from "@/lib/mcp/connections";
import { listMcpConnections, type McpConnection } from "@/lib/mcp/connections-queries";
import { resolveIssuer } from "@/lib/mcp-oauth/http";
import { AiPageClient, type ConnectionRow } from "./ai-page-client";

export const dynamic = "force-dynamic";

const toRow = (c: McpConnection): ConnectionRow => ({
  ...c,
  firstConnectedAt: c.firstConnectedAt.toISOString(),
  lastActivityAt: c.lastActivityAt.toISOString(),
});

export default async function AiPage() {
  const actor = await requirePagePermission(MCP_PAGE_PERMISSION);
  const managesTeam = hasBackofficePermission(actor, "team:manage");
  const [mine, team] = await Promise.all([
    listMcpConnections(actor.email),
    managesTeam ? listMcpConnections(null) : null,
  ]);

  return (
    <AiPageClient
      serverUrl={mcpServerUrl(resolveIssuer(await headers()))}
      capabilities={capabilitiesFor(actor)}
      ownConnections={mine.map(toRow)}
      teamConnections={team?.map(toRow) ?? null}
    />
  );
}
