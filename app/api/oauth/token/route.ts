import {
  clientCredentialsFrom,
  corsPreflight,
  oauthJson,
  readFormBody,
  tokenErrorResponse,
} from "@/lib/mcp-oauth/http";
import { mcpOauthService } from "@/lib/mcp-oauth/store";

export async function POST(request: Request) {
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
