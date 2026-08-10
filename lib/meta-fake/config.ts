export const META_FAKE_SCENARIO_USER_IDS_ENV = "META_FAKE_SCENARIO_USER_IDS";
export const META_FAKE_SCENARIO_KEY = "full_demo" as const;
export const META_FAKE_SKIP_REASON = "fake_meta_scenario" as const;

function resolveAppEnvLite(
  value = process.env.APP_ENV?.trim().toLowerCase(),
): "local" | "staging" | "prod" {
  if (value === "staging") return "staging";
  if (value === "prod" || value === "production") return "prod";
  return "local";
}

type MetaFakeEnv = {
  APP_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
};

/**
 * Fake Meta is allowed only in staging/local (or staging git branch).
 * Production always forces real Meta even if the allowlist env is present.
 *
 * The cast on the default exists because `MetaFakeEnv` is a weak type (all
 * properties optional): assigning `process.env` to it fails the weak-type
 * check on Vercel's build ("has no properties in common").
 */
export function isMetaFakeScenarioEnvAllowed(
  env: MetaFakeEnv = process.env as MetaFakeEnv,
): boolean {
  if (resolveAppEnvLite(env.APP_ENV) === "prod") {
    return false;
  }
  const appEnv = resolveAppEnvLite(env.APP_ENV);
  if (appEnv === "staging" || appEnv === "local") {
    return true;
  }
  const branch = env.VERCEL_GIT_COMMIT_REF?.trim().toLowerCase();
  return branch === "staging";
}

/** Parse comma/whitespace-separated UUIDs. Exact match only — no substrings. */
export function parseMetaFakeScenarioUserIds(
  raw: string | undefined = process.env[META_FAKE_SCENARIO_USER_IDS_ENV],
): Set<string> {
  if (!raw?.trim()) return new Set();
  const ids = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    const id = part.trim().toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}

export function isMetaFakeScenarioUser(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Same weak-type story as the default above: NodeJS.ProcessEnv is not
  // assignable to MetaFakeEnv on Vercel's build, so cast at the boundary.
  if (!userId || !isMetaFakeScenarioEnvAllowed(env as MetaFakeEnv)) {
    return false;
  }
  const allowlist = parseMetaFakeScenarioUserIds(
    env[META_FAKE_SCENARIO_USER_IDS_ENV],
  );
  return allowlist.has(userId.trim().toLowerCase());
}
