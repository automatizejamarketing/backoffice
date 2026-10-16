import { checkRateLimit } from "@/lib/security/rate-limit";
import { corsPreflight, oauthJson } from "@/lib/mcp-oauth/http";
import { mcpOauthService } from "@/lib/mcp-oauth/store";

/** Anyone can register (RFC 7591), so keep one IP from filling the table. */
const REGISTER_RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = checkRateLimit(`mcp-oauth-register:${ip}`, REGISTER_RATE_LIMIT);
  if (!limit.success) {
    return oauthJson(
      { error: "invalid_client_metadata", error_description: "Too many registrations." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const result = await mcpOauthService.registerClient(body);
  if (!result.ok) {
    return oauthJson({ error: result.error.error, error_description: result.error.description }, { status: 400 });
  }
  return oauthJson(result.response, { status: 201 });
}

export function OPTIONS() {
  return corsPreflight();
}
