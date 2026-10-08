import { generateProtectedResourceMetadata } from "mcp-handler";
import { MCP_SCOPES, mcpResourceUrl } from "@/lib/mcp-oauth/core";
import { corsPreflight, oauthJson, resolveIssuer } from "@/lib/mcp-oauth/http";

/** RFC 9728 — points `/api/mcp` at this app as its authorization server (root and path-suffixed forms). */
export function GET(request: Request) {
  const issuer = resolveIssuer(request.headers);
  return oauthJson(
    generateProtectedResourceMetadata({
      authServerUrls: [issuer],
      resourceUrl: mcpResourceUrl(issuer),
      additionalMetadata: {
        resource_name: "Automatize Backoffice",
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ["header"],
      },
    }),
  );
}

export function OPTIONS() {
  return corsPreflight();
}
