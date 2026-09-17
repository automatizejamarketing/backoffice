export type MetaAuthMode = "user" | "bisu";

/** Prefix so the customer callback never treats consultant OAuth as a user login. */
export const ADMIN_OAUTH_STATE_PREFIX = "adm.";

export function isAdminOauthState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(ADMIN_OAUTH_STATE_PREFIX);
}

export function defaultAdminReconnectMode(
  env: NodeJS.ProcessEnv = process.env,
): MetaAuthMode {
  return env.META_ADMIN_RECONNECT_MODE?.trim() === "user" ? "user" : "bisu";
}
