import { auth } from "@/app/(auth)/auth";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return auth(request as Parameters<typeof auth>[0]);
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
     * - favicon.ico (favicon file)
     */
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)",
  ],
};

