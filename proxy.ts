import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { safeLoginReturn } from "@/lib/auth/login-return";
import { BACKOFFICE_MAGIC_SESSION_COOKIE } from "@/lib/auth/magic-session-constants";

const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip authentication for auth API routes, Vercel cron jobs, and the Mat
  // intern report (that route validates Bearer MAT_PERFORMANCE_REPORT_SECRET).
  if (
    pathname.startsWith("/api/auth") ||
    // MCP connector: OAuth discovery/token endpoints are public; /api/mcp checks its own bearer.
    pathname.startsWith("/.well-known/oauth-") ||
    pathname.startsWith("/api/oauth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/cron-job") ||
    pathname.startsWith("/api/internal/client-reports/") ||
    pathname === "/api/internal/mat-performance-report"
  ) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });
  const hasMagicSessionCookie = Boolean(
    request.cookies.get(BACKOFFICE_MAGIC_SESSION_COOKIE)?.value,
  );

  // If not logged in and not on login page, redirect to login
  if (!token && !hasMagicSessionCookie && pathname !== "/login") {
    const login = new URL("/login", request.url);
    // Connecting an MCP client must come back to the consent page after signing in.
    if (pathname === "/oauth/authorize") login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  // If logged in and on login page, redirect to home
  if (token && pathname === "/login") {
    return NextResponse.redirect(new URL(safeLoginReturn(request.nextUrl.searchParams.get("next")) ?? "/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Protect all routes except auth routes and static files
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth API routes)
     * - login (login page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico / logo (public branding assets)
     * - common static file extensions under /public
     */
    "/((?!api/auth|api/cron-job|api/internal/client-reports/|api/internal/mat-performance-report|login|_next/static|_next/image|favicon.ico|logo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
