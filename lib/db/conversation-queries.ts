/**
 * Read-only access to the Mat conversation history (ADR 0018).
 * The backoffice never writes here — `automatize-frontend`'s Eve channels do.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  CLIENT_CONTEXT_PREFIX,
  countMessages,
  type ConversationEventRow,
} from "@/lib/backoffice/conversation-transcript";

import { db } from "./index";
import { conversation, conversationEvent } from "./schema";

export type ConversationChannel = "web" | "whatsapp";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConversationListItem = {
  id: string;
  channel: ConversationChannel;
  title: string | null;
  startedAt: Date;
  lastEventAt: Date;
  messageCount: number;
};

function getPostgresErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Missing table (42P01) => the migration has not reached this environment. */
function isMissingTable(error: unknown): boolean {
  return getPostgresErrorCode(error) === "42P01";
}

export async function listUserConversations(
  userId: string,
): Promise<ConversationListItem[]> {
  try {
    const rows = await db
      .select({
        id: conversation.id,
        channel: conversation.channel,
        title: conversation.title,
        startedAt: conversation.startedAt,
        lastEventAt: conversation.lastEventAt,
      })
      .from(conversation)
      .where(eq(conversation.userId, userId))
      .orderBy(desc(conversation.lastEventAt));

    if (rows.length === 0) return [];

    // Counted in SQL on purpose: a stored payload reaches 256 KB, so pulling every
    // event of every conversation just to count them would move megabytes.
    // The predicate MUST agree with `countMessages` (a real user line or a visible
    // Mat reply; never a synthetic `Client context:` injection) — change both.
    const ids = rows.map((row) => row.id);
    const counted = await db
      .select({
        conversationId: conversationEvent.conversationId,
        messageCount: sql<number>`count(*)::int`,
      })
      .from(conversationEvent)
      .where(
        and(
          inArray(conversationEvent.conversationId, ids),
          sql`btrim(coalesce(${conversationEvent.payload}->>'message', '')) <> ''`,
          sql`(
            ${conversationEvent.type} = 'message.completed'
            OR (
              ${conversationEvent.type} = 'message.received'
              AND btrim(${conversationEvent.payload}->>'message')
                  NOT LIKE ${`${CLIENT_CONTEXT_PREFIX}%`}
            )
          )`,
        ),
      )
      .groupBy(conversationEvent.conversationId);

    const countByConversation = new Map(
      counted.map((row) => [row.conversationId, row.messageCount]),
    );

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel as ConversationChannel,
      title: row.title,
      startedAt: row.startedAt,
      lastEventAt: row.lastEventAt,
      messageCount: countByConversation.get(row.id) ?? 0,
    }));
  } catch (error) {
    if (isMissingTable(error)) {
      console.warn(
        "[listUserConversations] Tabela conversations ausente. Aplique a migração 0025_conversations.",
      );
      return [];
    }
    throw error;
  }
}

export type ConversationWithEvents = {
  conversation: ConversationListItem;
  events: ConversationEventRow[];
};

/**
 * Loads one conversation and its ordered events. Returns null when the
 * conversation does not exist OR does not belong to `userId` — the caller
 * already checked the actor may read that user, so ownership must be enforced
 * here rather than trusting the id in the URL.
 */
export async function getUserConversation(params: {
  userId: string;
  conversationId: string;
}): Promise<ConversationWithEvents | null> {
  // The id arrives from the query string; a malformed one must not reach the
  // uuid cast (Postgres would raise 22P02 and 500 the page).
  if (!UUID_RE.test(params.conversationId)) return null;

  try {
    const [row] = await db
      .select({
        id: conversation.id,
        userId: conversation.userId,
        channel: conversation.channel,
        title: conversation.title,
        startedAt: conversation.startedAt,
        lastEventAt: conversation.lastEventAt,
      })
      .from(conversation)
      .where(eq(conversation.id, params.conversationId))
      .limit(1);

    if (!row || row.userId !== params.userId) return null;

    const events = (await db
      .select({
        id: conversationEvent.id,
        type: conversationEvent.type,
        turnId: conversationEvent.turnId,
        seq: conversationEvent.seq,
        payload: conversationEvent.payload,
        truncated: conversationEvent.truncated,
        createdAt: conversationEvent.createdAt,
      })
      .from(conversationEvent)
      .where(eq(conversationEvent.conversationId, row.id))
      // Insertion order IS transcript order (see schema note on `id`).
      .orderBy(asc(conversationEvent.id))) as ConversationEventRow[];

    return {
      conversation: {
        id: row.id,
        channel: row.channel as ConversationChannel,
        title: row.title,
        startedAt: row.startedAt,
        lastEventAt: row.lastEventAt,
        messageCount: countMessages(events),
      },
      events,
    };
  } catch (error) {
    if (isMissingTable(error)) {
      console.warn(
        "[getUserConversation] Tabela conversations ausente. Aplique a migração 0025_conversations.",
      );
      return null;
    }
    throw error;
  }
}
