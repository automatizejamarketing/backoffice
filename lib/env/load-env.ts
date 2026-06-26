import { config, parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppEnv = "local" | "staging" | "prod";

const ENV_FILES: Record<AppEnv, string> = {
  local: ".env.local",
  staging: ".env.staging",
  prod: ".env.prod",
};

export function resolveAppEnv(
  value = process.env.APP_ENV?.trim().toLowerCase(),
): AppEnv {
  if (value === "staging") {
    return "staging";
  }

  if (value === "prod" || value === "production") {
    return "prod";
  }

  return "local";
}

export function getEnvFilePath(appEnv: AppEnv, cwd = process.cwd()): string {
  return resolve(cwd, ENV_FILES[appEnv]);
}

// `NODE_ENV` must be managed by the tooling (Next sets it to `production`
// during `next build` and `development` during `next dev`). If an env file
// injects `NODE_ENV=development`, it overrides Next's build-time value and
// crashes the `/_global-error` prerender in Next 16. Never propagate it.
const PROTECTED_KEYS = new Set(["NODE_ENV"]);

function applyEnvFile(
  filePath: string,
  options: { override?: boolean; skipEmpty?: boolean } = {},
) {
  const parsed = parse(readFileSync(filePath));

  for (const [key, value] of Object.entries(parsed)) {
    if (PROTECTED_KEYS.has(key)) {
      continue;
    }

    if (options.skipEmpty && value === "") {
      continue;
    }

    if (!options.override && process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

export function loadAppEnv(cwd = process.cwd()): AppEnv {
  const appEnv = resolveAppEnv();

  if (existsSync(resolve(cwd, ".env"))) {
    // Preserve values injected by `vercel env run` (e.g. sensitive secrets).
    // Routed through `applyEnvFile` so `PROTECTED_KEYS` (NODE_ENV) are skipped.
    applyEnvFile(resolve(cwd, ".env"), { override: false });
  }

  const envFile = getEnvFilePath(appEnv, cwd);
  if (existsSync(envFile)) {
    // Vercel env pull writes empty strings for sensitive vars; do not clobber.
    applyEnvFile(envFile, { override: true, skipEmpty: true });
  } else if (appEnv !== "local") {
    console.warn(
      `[env] Missing ${ENV_FILES[appEnv]}. Copy from .env.local or pull from Vercel.`,
    );
  }

  process.env.APP_ENV = appEnv;

  return appEnv;
}
