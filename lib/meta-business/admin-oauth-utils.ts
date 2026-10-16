export type MetaAuthMode = "user" | "bisu";

/** Prefix so the customer callback never treats consultant OAuth as a user login. */
export const ADMIN_OAUTH_STATE_PREFIX = "adm.";

export function isAdminOauthState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(ADMIN_OAUTH_STATE_PREFIX);
}

/**
 * `auth_mode` stored when the consultant is only saving their own personal
 * Facebook token for the certification fallback. Twin of the frontend constant:
 * its callback saves the credential and leaves the client's connection alone.
 */
export const CONSULTANT_CREDENTIAL_AUTH_MODE = "consultant";

export function defaultAdminReconnectMode(
  env: NodeJS.ProcessEnv = process.env,
): MetaAuthMode {
  return env.META_ADMIN_RECONNECT_MODE?.trim() === "user" ? "user" : "bisu";
}
