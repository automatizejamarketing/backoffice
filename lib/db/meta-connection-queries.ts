import { and, eq, isNull, ne } from "drizzle-orm";

import { db } from "./index";
import { metaBusinessAccount } from "./schema";

/**
 * Persiste a invalidação terminal de um token sem regravar a mesma conexão em
 * cada etapa/cron. O motivo é estruturado e não inclui mensagem da Meta, token,
 * e-mail ou identificadores de conta de anúncio.
 */
export async function markMetaConnectionNeedsReconnect(args: {
  userId: string;
  connectionId?: string;
  code: number;
  subcode?: number;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const reason = `graph_token_invalid:${args.code}${
    args.subcode === undefined ? "" : `/${args.subcode}`
  }`;

  await db
    .update(metaBusinessAccount)
    .set({
      connectionStatus: "needs_reconnect",
      lastValidationError: reason,
      lastValidatedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        args.connectionId
          ? eq(metaBusinessAccount.id, args.connectionId)
          : eq(metaBusinessAccount.userId, args.userId),
        isNull(metaBusinessAccount.deletedAt),
        ne(metaBusinessAccount.connectionStatus, "needs_reconnect"),
      ),
    );
}
