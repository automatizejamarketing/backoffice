import crypto from "node:crypto";

/**
 * appsecret_proof = HMAC-SHA256(access_token, app_secret), hex-encoded.
 *
 * ONLY valid for Graph API calls authenticated with a USER or PAGE access
 * token. NEVER attach to the OAuth code->token exchange, fb_exchange_token, or
 * debug_token: those authenticate with client_id+client_secret or an app token
 * and Meta rejects an appsecret_proof there.
 */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return crypto
    .createHmac("sha256", appSecret)
    .update(accessToken)
    .digest("hex");
}

export function facebookAppSecret(): string | undefined {
  return process.env.META_GENERAL_APP_SECRET;
}

/**
 * Returns `appsecret_proof=<hex>` for appending to a Graph query string, or an
 * empty string when the app secret is absent. The empty-string degrade keeps
 * every currently-working call working if the env var is ever unset; Meta only
 * rejects a missing proof when the app has "Require app secret proof" enabled.
 */
export function appSecretProofParam(
  accessToken: string,
  appSecret: string | undefined,
): string {
  if (!appSecret) return "";
  return `appsecret_proof=${appSecretProof(accessToken, appSecret)}`;
}
