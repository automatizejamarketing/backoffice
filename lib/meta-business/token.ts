import { graphFacebookBaseUrl, graphApiVersion } from "./constant";
import { GraphApiError, parseGraphError } from "./error";

function getFacebookAppCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.NEXT_PUBLIC_META_GENERAL_APP_ID;
  const appSecret = process.env.META_GENERAL_APP_SECRET;
  if (!appId || !appSecret) {
    throw new GraphApiError({
      statusCode: 500,
      reason: {
        httpStatusCode: 500,
        title: "Configuração da Meta ausente",
        message:
          "NEXT_PUBLIC_META_GENERAL_APP_ID e/ou META_GENERAL_APP_SECRET não estão configurados.",
        solution: "Configure as variáveis de ambiente da Meta no backoffice.",
        isTransient: false,
      },
    });
  }
  return { appId, appSecret };
}

export type DebugTokenData = {
  app_id?: string;
  type?: string;
  application?: string;
  data_access_expires_at?: number;
  expires_at?: number;
  is_valid: boolean;
  scopes?: string[];
  user_id?: string;
  // Meta nests this inside data.data when the inspected token is invalid
  // (e.g. code 190 / subcode 460 after a password change).
  error?: { code: number; subcode?: number; message: string };
};

/**
 * Inspect an access token via the Graph debug_token endpoint.
 *
 * Authenticated with the APP token (`appId|appSecret`) — NEVER add an
 * appsecret_proof here (Meta rejects it for app-token calls).
 */
export async function debugToken(accessToken: string): Promise<DebugTokenData> {
  const { appId, appSecret } = getFacebookAppCredentials();

  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  });

  const response = await fetch(
    `${graphFacebookBaseUrl}/${graphApiVersion}/debug_token?${params.toString()}`,
  );
  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("Error debugging Facebook token:", data);
    throw new GraphApiError(parseGraphError(data));
  }

  return data.data as DebugTokenData;
}

/**
 * Refresh a long-lived user token via fb_exchange_token.
 *
 * Only succeeds while the current token is still valid; a 190/460-invalidated
 * token CANNOT be refreshed (Meta requires the user to re-authenticate).
 * Authenticated with client_id+client_secret — NEVER add an appsecret_proof.
 */
export async function refreshLongLivedToken(currentToken: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
}> {
  const { appId, appSecret } = getFacebookAppCredentials();

  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: currentToken,
  });

  const response = await fetch(
    `${graphFacebookBaseUrl}/${graphApiVersion}/oauth/access_token?${params.toString()}`,
  );
  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("Error refreshing Facebook long-lived token:", data);
    throw new GraphApiError(parseGraphError(data));
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type ?? "bearer",
    expires_in: data.expires_in ?? 5184000,
  };
}
