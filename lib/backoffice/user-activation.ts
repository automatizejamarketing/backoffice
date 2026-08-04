import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  user,
  verificationToken,
} from "@/lib/db/schema";
import {
  buildUserActivationUrl,
  canManageUserActivation,
} from "./user-activation-policy";

const VERIFICATION_EMAIL = "email_verification";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type ActivationError = "user_not_found" | "activation_not_available";

function getFrontendOrigin(): string {
  const configured = process.env.FRONTEND_APP_URL?.trim();
  if (configured) return configured;

  if (process.env.APP_ENV === "prod") {
    return "https://automatizemarketing.com";
  }
  if (process.env.APP_ENV === "staging") {
    return "https://staging.automatizemarketing.com";
  }
  return "http://localhost:3000";
}

async function findActivationUser(userId: string) {
  const [found] = await db
    .select({
      id: user.id,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return found ?? null;
}

export async function getOrCreateUserActivationLink(data: {
  userId: string;
  adminEmail: string;
}): Promise<
  | { ok: true; activationUrl: string; expiresAt: Date; reused: boolean }
  | { ok: false; error: ActivationError }
> {
  const target = await findActivationUser(data.userId);
  if (!target) return { ok: false, error: "user_not_found" };
  if (!canManageUserActivation(target)) {
    return { ok: false, error: "activation_not_available" };
  }

  const now = new Date();
  const [existing] = await db
    .select({
      token: verificationToken.token,
      expiresAt: verificationToken.expiresAt,
    })
    .from(verificationToken)
    .where(
      and(
        eq(verificationToken.userId, data.userId),
        eq(verificationToken.type, VERIFICATION_EMAIL),
        isNull(verificationToken.usedAt),
        gt(verificationToken.expiresAt, now),
      ),
    )
    .orderBy(desc(verificationToken.createdAt))
    .limit(1);

  let token = existing?.token;
  let expiresAt = existing?.expiresAt;
  if (!token || !expiresAt) {
    token = randomBytes(32).toString("hex");
    expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    await db.insert(verificationToken).values({
      userId: data.userId,
      token,
      type: VERIFICATION_EMAIL,
      expiresAt,
    });
  }

  await db.insert(backofficeAuditLog).values({
    adminEmail: data.adminEmail,
    targetUserId: data.userId,
    action: "create_activation_link",
    fieldName: "email_verified",
    oldValue: null,
    newValue: existing ? "reused" : "created",
    note: existing
      ? "Link de ativação válido recuperado pelo Backoffice"
      : "Novo link de ativação criado pelo Backoffice",
  });

  return {
    ok: true,
    activationUrl: buildUserActivationUrl(token, getFrontendOrigin()),
    expiresAt,
    reused: Boolean(existing),
  };
}

export async function activateUserAccount(data: {
  userId: string;
  adminEmail: string;
}): Promise<
  | { ok: true; emailVerified: Date }
  | { ok: false; error: ActivationError }
> {
  const target = await findActivationUser(data.userId);
  if (!target) return { ok: false, error: "user_not_found" };
  if (!canManageUserActivation(target)) {
    return { ok: false, error: "activation_not_available" };
  }

  const verifiedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ emailVerified: verifiedAt })
      .where(eq(user.id, data.userId));

    await tx
      .update(verificationToken)
      .set({ usedAt: verifiedAt })
      .where(
        and(
          eq(verificationToken.userId, data.userId),
          eq(verificationToken.type, VERIFICATION_EMAIL),
          isNull(verificationToken.usedAt),
        ),
      );

    await tx.insert(backofficeAuditLog).values({
      adminEmail: data.adminEmail,
      targetUserId: data.userId,
      action: "activate_user_account",
      fieldName: "email_verified",
      oldValue: null,
      newValue: verifiedAt.toISOString(),
      note: "Conta ativada manualmente pelo Backoffice",
    });
  });

  return { ok: true, emailVerified: verifiedAt };
}
