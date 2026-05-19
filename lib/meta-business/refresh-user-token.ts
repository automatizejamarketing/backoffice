import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { backofficeAuditLog, metaBusinessAccount } from "@/lib/db/schema";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  GraphApiError,
  graphErrorToClientError,
  parseGraphError,
} from "./error";
import { debugToken, refreshLongLivedToken } from "./token";

type ClientError = { error: string; message: string; solution: string };

export type RefreshOutcome =
  | { ok: true; status: "refreshed"; newExpiresAt: string }
  | { ok: false; status: "needs_reconnect"; clientError: ClientError }
  | { ok: false; status: "error"; clientError: ClientError };

const NO_ACCOUNT: ClientError = {
  error: "Conta não conectada",
  message:
    "Este usuário não tem uma conta de marketing do Facebook conectada.",
  solution: "O usuário precisa conectar a conta do Facebook pelo site.",
};

/**
 * Best-effort programmatic token renewal for the backoffice admin action.
 *
 * Flow: inspect the stored token with debug_token; if it is already invalid
 * (the 190/460 "session invalidated" case) we DO NOT attempt fb_exchange —
 * Meta cannot revive it and the user must re-authenticate. If it is still
 * valid we mint a fresh long-lived token and persist it.
 *
 * NOTE: the DB write below is a deliberate, user-requested deviation from
 * backoffice's read-only posture for Meta data (see backoffice/CLAUDE.md). It
 * mirrors what the frontend refresh-tokens cron already does, and is audited
 * via backofficeAuditLog. The raw token is NEVER logged — only the expiry
 * transition is recorded.
 */
export async function refreshUserMetaToken(args: {
  userId: string;
  adminEmail: string;
}): Promise<RefreshOutcome> {
  const { userId, adminEmail } = args;

  const account = await getUserMetaBusinessAccount(userId);
  if (!account) {
    return { ok: false, status: "needs_reconnect", clientError: NO_ACCOUNT };
  }

  let debug;
  try {
    debug = await debugToken(account.accessToken);
  } catch (error) {
    if (error instanceof GraphApiError) {
      return {
        ok: false,
        status: "needs_reconnect",
        clientError: graphErrorToClientError(error.errorReturn),
      };
    }
    throw error;
  }

  if (!debug.is_valid) {
    const errReturn = parseGraphError({
      error: {
        type: "OAuthException",
        code: debug.error?.code ?? 190,
        error_subcode: debug.error?.subcode,
        message: debug.error?.message ?? "Token inválido",
      },
    });
    return {
      ok: false,
      status: "needs_reconnect",
      clientError: graphErrorToClientError(errReturn),
    };
  }

  let refreshed;
  try {
    refreshed = await refreshLongLivedToken(account.accessToken);
  } catch (error) {
    if (error instanceof GraphApiError) {
      const code = error.errorReturn.data?.code;
      return {
        ok: false,
        status: code === 190 ? "needs_reconnect" : "error",
        clientError: graphErrorToClientError(error.errorReturn),
      };
    }
    throw error;
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  const oldExpiresAt = account.tokenExpiresAt
    ? new Date(account.tokenExpiresAt).toISOString()
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(metaBusinessAccount)
      .set({
        accessToken: refreshed.access_token,
        tokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(metaBusinessAccount.id, account.id));

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: "refresh_meta_token",
      fieldName: "meta_token_expires_at",
      oldValue: oldExpiresAt,
      newValue: newExpiresAt.toISOString(),
      note: "Renovação manual do token long-lived do Facebook pelo backoffice",
    });
  });

  return {
    ok: true,
    status: "refreshed",
    newExpiresAt: newExpiresAt.toISOString(),
  };
}
