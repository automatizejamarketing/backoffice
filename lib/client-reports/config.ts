function parseCsvIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isClientReportsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CLIENT_REPORTS_ENABLED === "false") return false;
  return env.CLIENT_REPORTS_ENABLED === "true" || env.NODE_ENV !== "production";
}

export function clientReportsAllowlistedUserIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return parseCsvIds(env.CLIENT_REPORTS_USER_ALLOWLIST);
}

export function isClientReportsUserAllowed(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allowlist = clientReportsAllowlistedUserIds(env);
  if (allowlist.length === 0) return true;
  return allowlist.includes(userId);
}

export const CLIENT_REPORTS_THRESHOLDS = {
  goodRoas: 2,
  paidBackMinRoas: 1,
  paidBackMinDays: 30,
  personalBestMinSpend: 50,
  benchmarkMinSample: 20,
} as const;
