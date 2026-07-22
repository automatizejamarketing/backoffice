/**
 * Resolves the public app origin for auth redirects and magic links.
 *
 * When running via Portless with production/staging env files, `NEXTAUTH_URL`
 * still points at the deployed host. Prefer the local public URL so magic
 * links stay on this machine.
 */
export function getAppUrl(request: Request): string {
  const portlessUrl = process.env.PORTLESS_URL?.trim();
  if (portlessUrl) {
    return stripTrailingSlash(portlessUrl);
  }

  const forwardedOrigin = getForwardedOrigin(request);
  if (forwardedOrigin && isLocalOrigin(forwardedOrigin)) {
    return forwardedOrigin;
  }

  const requestOrigin = new URL(request.url).origin;
  if (isLocalOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return stripTrailingSlash(
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.AUTH_URL?.trim() ||
      process.env.NEXTAUTH_URL?.trim() ||
      requestOrigin,
  );
}

function getForwardedOrigin(request: Request): string | null {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host) return null;

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.includes("localhost") ? "https" : "http");

  return `${proto}://${host}`;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
