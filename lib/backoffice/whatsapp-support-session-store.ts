import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  user,
  whatsappSupportSession,
  whatsappSupportSessionEvent,
  type WhatsappSupportEnvironment,
} from "@/lib/db/schema";
import {
  generateWhatsappSupportActivationCode,
  hashWhatsappSupportActivationCode,
  WHATSAPP_SUPPORT_ACTIVATION_TTL_MS,
} from "./whatsapp-support-session-core";

export type WhatsappSupportSessionView = {
  id: string;
  operatorEmail: string;
  targetUserId: string;
  phoneE164: string;
  environment: WhatsappSupportEnvironment;
  reason: string;
  durationMinutes: number;
  state: "pending" | "active";
  activationCodeExpiresAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

function toView(
  row: typeof whatsappSupportSession.$inferSelect,
): WhatsappSupportSessionView {
  return {
    id: row.id,
    operatorEmail: row.operatorEmail,
    targetUserId: row.targetUserId,
    phoneE164: row.phoneE164,
    environment: row.environment,
    reason: row.reason,
    durationMinutes: row.durationMinutes,
    state: row.activatedAt ? "active" : "pending",
    activationCodeExpiresAt: row.activationCodeExpiresAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getCurrentWhatsappSupportSession(params: {
  targetUserId: string;
  environment: WhatsappSupportEnvironment;
}): Promise<WhatsappSupportSessionView | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(whatsappSupportSession)
    .where(
      and(
        eq(whatsappSupportSession.targetUserId, params.targetUserId),
        eq(whatsappSupportSession.environment, params.environment),
        isNull(whatsappSupportSession.endedAt),
        or(
          and(
            isNull(whatsappSupportSession.activatedAt),
            gt(whatsappSupportSession.activationCodeExpiresAt, now),
          ),
          and(
            isNotNull(whatsappSupportSession.activatedAt),
            gt(whatsappSupportSession.expiresAt, now),
          ),
        ),
      ),
    )
    .orderBy(desc(whatsappSupportSession.createdAt))
    .limit(1);

  return row ? toView(row) : null;
}

export async function createWhatsappSupportSession(params: {
  operatorEmail: string;
  targetUserId: string;
  phoneE164: string;
  environment: WhatsappSupportEnvironment;
  reason: string;
  durationMinutes: number;
}): Promise<
  | {
      ok: true;
      session: WhatsappSupportSessionView;
      activationCode: string;
    }
  | { ok: false; reason: "user_not_found" }
> {
  const sessionId = randomUUID();
  const activationCode = generateWhatsappSupportActivationCode();
  const now = new Date();
  const activationCodeExpiresAt = new Date(
    now.getTime() + WHATSAPP_SUPPORT_ACTIVATION_TTL_MS,
  );

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, params.targetUserId))
      .limit(1);
    if (!target) {
      return { ok: false as const, reason: "user_not_found" as const };
    }

    const [created] = await tx
      .insert(whatsappSupportSession)
      .values({
        id: sessionId,
        operatorEmail: params.operatorEmail,
        targetUserId: params.targetUserId,
        phoneE164: params.phoneE164,
        environment: params.environment,
        reason: params.reason,
        durationMinutes: params.durationMinutes,
        activationCodeHash: hashWhatsappSupportActivationCode(
          sessionId,
          activationCode,
        ),
        activationCodeExpiresAt,
      })
      .returning();

    await tx.insert(whatsappSupportSessionEvent).values({
      sessionId,
      eventType: "session.requested",
      payload: {
        operatorEmail: params.operatorEmail,
        environment: params.environment,
        phoneE164: params.phoneE164,
        durationMinutes: params.durationMinutes,
        reason: params.reason,
      },
    });
    await tx.insert(backofficeAuditLog).values({
      adminEmail: params.operatorEmail,
      targetUserId: params.targetUserId,
      action: "create_whatsapp_support_session",
      fieldName: "whatsapp_support_session",
      oldValue: null,
      newValue: JSON.stringify({
        sessionId,
        environment: params.environment,
        phoneE164: params.phoneE164,
        durationMinutes: params.durationMinutes,
        state: "pending",
      }),
      note: params.reason,
    });

    return {
      ok: true as const,
      session: toView(created),
      activationCode,
    };
  });
}

export async function endWhatsappSupportSessionFromBackoffice(params: {
  sessionId: string;
  targetUserId: string;
  environment: WhatsappSupportEnvironment;
  operatorEmail: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(whatsappSupportSession)
      .set({
        endedAt: new Date(),
        endedByEmail: params.operatorEmail,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappSupportSession.id, params.sessionId),
          eq(whatsappSupportSession.targetUserId, params.targetUserId),
          eq(whatsappSupportSession.environment, params.environment),
          isNull(whatsappSupportSession.endedAt),
        ),
      )
      .returning({
        id: whatsappSupportSession.id,
        phoneE164: whatsappSupportSession.phoneE164,
      });

    if (!ended) {
      return false;
    }

    await tx.insert(whatsappSupportSessionEvent).values({
      sessionId: ended.id,
      eventType: "session.ended_from_backoffice",
      payload: { operatorEmail: params.operatorEmail },
    });
    await tx.insert(backofficeAuditLog).values({
      adminEmail: params.operatorEmail,
      targetUserId: params.targetUserId,
      action: "end_whatsapp_support_session",
      fieldName: "whatsapp_support_session",
      oldValue: JSON.stringify({
        sessionId: ended.id,
        phoneE164: ended.phoneE164,
      }),
      newValue: "ended",
    });
    return true;
  });
}
