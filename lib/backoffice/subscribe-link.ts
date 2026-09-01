import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  subscription,
  user,
  verificationToken,
} from "@/lib/db/schema";
import { getFrontendOrigin } from "./user-activation";
import {
  buildSubscribeLinkUrl,
  getSubscribeLinkDisabledReason,
  SUBSCRIBE_LINK_TTL_MS,
} from "./subscribe-link-policy";

/**
 * Link público de assinatura — o Backoffice cria a linha em
 * `verification_tokens` (type `subscribe_link`) e o frontend a consome em
 * `/pagar/<token>`. Mesmo molde do link de ativação, com duas diferenças:
 * TTL de 7 dias e token reutilizável (o frontend nunca preenche `used_at`;
 * preenchido significa revogado).
 */
const VERIFICATION_SUBSCRIBE_LINK = "subscribe_link";

type SubscribeLinkError = "user_not_found" | "subscribe_link_not_available";

export async function getOrCreateUserSubscribeLink(data: {
  userId: string;
  adminEmail: string;
}): Promise<
  | { ok: true; subscribeUrl: string; expiresAt: Date; reused: boolean }
  | { ok: false; error: SubscribeLinkError; reason?: string }
> {
  const [target] = await db
    .select({
      id: user.id,
      expirationDate: user.expirationDate,
    })
    .from(user)
    .where(eq(user.id, data.userId))
    .limit(1);
  if (!target) return { ok: false, error: "user_not_found" };

  const liveSubscriptions = await db
    .select({
      provider: subscription.provider,
      status: subscription.status,
    })
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, data.userId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
      ),
    );

  const disabledReason = getSubscribeLinkDisabledReason({
    expirationDate: target.expirationDate,
    subscriptions: liveSubscriptions,
  });
  if (disabledReason) {
    return {
      ok: false,
      error: "subscribe_link_not_available",
      reason: disabledReason,
    };
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
        eq(verificationToken.type, VERIFICATION_SUBSCRIBE_LINK),
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
    expiresAt = new Date(now.getTime() + SUBSCRIBE_LINK_TTL_MS);
    await db.insert(verificationToken).values({
      userId: data.userId,
      token,
      type: VERIFICATION_SUBSCRIBE_LINK,
      expiresAt,
    });
  }

  await db.insert(backofficeAuditLog).values({
    adminEmail: data.adminEmail,
    targetUserId: data.userId,
    action: "create_subscribe_link",
    fieldName: "subscribe_link",
    oldValue: null,
    newValue: existing ? "reused" : "created",
    note: existing
      ? "Link de assinatura válido recuperado pelo Backoffice"
      : "Novo link de assinatura criado pelo Backoffice",
  });

  return {
    ok: true,
    subscribeUrl: buildSubscribeLinkUrl(token, getFrontendOrigin()),
    expiresAt,
    reused: Boolean(existing),
  };
}
