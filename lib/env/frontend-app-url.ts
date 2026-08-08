import { resolveAppEnv } from "./load-env";

const PROD_FRONTEND_ORIGIN = "https://www.automatizemarketing.com";
const STAGING_FRONTEND_ORIGIN = "https://staging.automatizemarketing.com";
const LOCAL_FRONTEND_ORIGIN = "http://localhost:3000";

function normalizeFrontendOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "https://automatizemarketing.com") {
    return PROD_FRONTEND_ORIGIN;
  }
  return trimmed;
}

export function resolveFrontendAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    env.FRONTEND_APP_URL?.trim() ||
    env.FRONTEND_URL?.trim() ||
    env.NEXT_PUBLIC_FRONTEND_APP_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    return normalizeFrontendOrigin(configured);
  }

  switch (resolveAppEnv(env.APP_ENV)) {
    case "staging":
      return STAGING_FRONTEND_ORIGIN;
    case "prod":
      return PROD_FRONTEND_ORIGIN;
    default:
      return LOCAL_FRONTEND_ORIGIN;
  }
}
