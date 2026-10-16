import { buildAuthorizationServerMetadata } from "@/lib/mcp-oauth/core";
import { corsPreflight, oauthJson, resolveIssuer } from "@/lib/mcp-oauth/http";

/** RFC 8414 — MCP clients discover the authorize/token/register endpoints here. */
export function GET(request: Request) {
  return oauthJson(buildAuthorizationServerMetadata(resolveIssuer(request.headers)));
}

export function OPTIONS() {
  return corsPreflight();
}
