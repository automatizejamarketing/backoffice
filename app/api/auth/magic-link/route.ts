import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUrl } from "@/lib/auth/app-url";
import { canBackofficeEmailSignIn } from "@/lib/auth/backoffice-users";
import {
  createBackofficeMagicLinkToken,
  getBackofficeMagicLinkExpiresAt,
  hashBackofficeMagicLinkToken,
  normalizeBackofficeEmail,
} from "@/lib/auth/magic-link";
import { db } from "@/lib/db";
import { backofficeMagicLink } from "@/lib/db/schema";
import { sendBackofficeMagicLinkEmail } from "@/lib/email/backoffice-magic-link-email";

const magicLinkLoginSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = magicLinkLoginSchema.parse(body);
    const normalizedEmail = normalizeBackofficeEmail(email);
    const exposeMagicLinkInResponse = process.env.NODE_ENV !== "production";

    if (!(await canBackofficeEmailSignIn(normalizedEmail))) {
      return NextResponse.json(
        { error: "Este e-mail não está autorizado para acessar o backoffice." },
        { status: 403 },
      );
    }

    const token = createBackofficeMagicLinkToken();
    const tokenHash = hashBackofficeMagicLinkToken(token);
    const expiresAt = getBackofficeMagicLinkExpiresAt();

    await db.insert(backofficeMagicLink).values({
      email: normalizedEmail,
      tokenHash,
      expiresAt,
    });

    const magicLinkUrl = new URL("/api/auth/magic-link/verify", getAppUrl(request));
    magicLinkUrl.searchParams.set("token", token);
    const magicLink = magicLinkUrl.toString();
    const emailResult = await sendBackofficeMagicLinkEmail({
      email: normalizedEmail,
      magicLink,
    });

    return NextResponse.json({
      ok: true as const,
      sent: emailResult.sent,
      ...(exposeMagicLinkInResponse ? { devMagicLink: magicLink } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    console.error("[BACKOFFICE_MAGIC_LINK_LOGIN_ERROR]", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
