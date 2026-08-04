import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { BACKOFFICE_MAGIC_SESSION_COOKIE } from "@/lib/auth/magic-session-constants";

const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip authentication for auth API routes and Vercel cron jobs
  // (cron routes validate Bearer CRON_SECRET themselves).
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron-job")
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
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // If logged in and on login page, redirect to home
  if (token && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
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
    "/((?!api/auth|api/cron-job|login|_next/static|_next/image|favicon.ico|logo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
