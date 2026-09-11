export type MetaAuthMode = "user" | "bisu";

export function defaultAdminReconnectMode(
  env: NodeJS.ProcessEnv = process.env,
): MetaAuthMode {
  return env.META_ADMIN_RECONNECT_MODE?.trim() === "bisu" ? "bisu" : "user";
}
