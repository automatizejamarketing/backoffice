import {
  clientCredentialsFrom,
  corsPreflight,
  oauthJson,
  readFormBody,
  tokenErrorResponse,
} from "@/lib/mcp-oauth/http";
import { mcpOauthService } from "@/lib/mcp-oauth/store";

/** Another grant of the same person + app held the lock past `lock_timeout`. */
function isLockTimeout(error: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined);
  return code(error) === "55P03" || code(error && typeof error === "object" && "cause" in error ? error.cause : undefined) === "55P03";
}

export async function POST(request: Request) {
  try {
    return await grant(request);
  } catch (error) {
    if (!isLockTimeout(error)) throw error;
    return oauthJson(
      { error: "temporarily_unavailable", error_description: "Try again in a few seconds." },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
}

async function grant(request: Request) {
  const form = await readFormBody(request);
  const credentials = clientCredentialsFrom(request, form);

  switch (form.get("grant_type")) {
    case "authorization_code": {
      const result = await mcpOauthService.exchangeAuthorizationCode({
        credentials,
        code: form.get("code"),
        codeVerifier: form.get("code_verifier"),
        redirectUri: form.get("redirect_uri"),
        resource: form.get("resource"),
      });
      return result.ok ? oauthJson(result.body) : tokenErrorResponse(result);
    }
    case "refresh_token": {
      const result = await mcpOauthService.refreshAccessToken({
        credentials,
        refreshToken: form.get("refresh_token"),
        scope: form.get("scope"),
      });
      return result.ok ? oauthJson(result.body) : tokenErrorResponse(result);
    }
    default:
      return tokenErrorResponse({
        ok: false,
        error: "unsupported_grant_type",
        description: "grant_type must be authorization_code or refresh_token.",
      });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
