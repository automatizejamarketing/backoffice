import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/auth/app-url";
import { canBackofficeEmailSignIn } from "@/lib/auth/backoffice-users";
import {
  hashBackofficeMagicLinkToken,
  normalizeBackofficeEmail,
} from "@/lib/auth/magic-link";
import {
  BACKOFFICE_MAGIC_SESSION_COOKIE,
  BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
  createBackofficeMagicSessionToken,
} from "@/lib/auth/magic-session";
import { db } from "@/lib/db";
import { backofficeMagicLink } from "@/lib/db/schema";

function redirectToLogin(request: Request, error: string) {
  const loginUrl = new URL("/login", getAppUrl(request));
  loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return redirectToLogin(request, "magic_invalid");
    }

    const [storedToken] = await db
      .select()
      .from(backofficeMagicLink)
      .where(eq(backofficeMagicLink.tokenHash, hashBackofficeMagicLinkToken(token)))
      .limit(1);

    if (!storedToken) {
      return redirectToLogin(request, "magic_invalid");
    }

    if (storedToken.usedAt) {
      return redirectToLogin(request, "magic_used");
    }

    if (storedToken.expiresAt < new Date()) {
      return redirectToLogin(request, "magic_expired");
    }

    const email = normalizeBackofficeEmail(storedToken.email);
    if (!(await canBackofficeEmailSignIn(email))) {
      return redirectToLogin(request, "unauthorized");
    }

    await db
      .update(backofficeMagicLink)
      .set({ usedAt: new Date() })
      .where(eq(backofficeMagicLink.id, storedToken.id));

    const sessionToken = createBackofficeMagicSessionToken(email);
    const response = NextResponse.redirect(new URL("/", getAppUrl(request)));

    response.cookies.set(BACKOFFICE_MAGIC_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: BACKOFFICE_MAGIC_SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[BACKOFFICE_MAGIC_LINK_VERIFY_ERROR]", error);
    return redirectToLogin(request, "magic_error");
  }
}
