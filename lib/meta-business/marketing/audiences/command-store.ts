import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaAudienceCommand } from "@/lib/db/schema";

export type AudienceCommandStatus = "pending" | "completed" | "uncertain";
export type AudienceCommandRecord = { commandId: string; status: AudienceCommandStatus; result?: unknown; acquired?: boolean; expired?: boolean };
export type AudienceCommandStore = {
  claim(input: { commandId: string; actorUserId: string; accountId: string; audienceId: string; request: Record<string, unknown> }): Promise<AudienceCommandRecord>;
  get(commandId: string): Promise<AudienceCommandRecord | undefined>;
  complete(commandId: string, result: unknown): Promise<void>;
  markUncertain(commandId: string): Promise<void>;
};
const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function toRecord(row: typeof metaAudienceCommand.$inferSelect): AudienceCommandRecord { return { commandId: row.commandId, status: row.status as AudienceCommandStatus, result: row.result ?? undefined }; }
export function createPostgresAudienceCommandStore(): AudienceCommandStore {
  return {
    async claim(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId}, 0))`);
        const [existing] = await tx.select().from(metaAudienceCommand).where(eq(metaAudienceCommand.commandId, input.commandId)).limit(1);
        if (existing) return existing.expiresAt <= new Date() ? { ...toRecord(existing), expired: true, acquired: false } : { ...toRecord(existing), acquired: false };
        const [inserted] = await tx.insert(metaAudienceCommand).values({ commandId: input.commandId, actorUserId: input.actorUserId, accountId: input.accountId, audienceId: input.audienceId, request: input.request, status: "pending", expiresAt: new Date(Date.now() + COMMAND_TTL_MS), updatedAt: new Date() }).returning();
        return inserted ? { ...toRecord(inserted), acquired: true } : { commandId: input.commandId, status: "uncertain" as const, acquired: false };
      });
    },
    async get(commandId) { const [row] = await db.select().from(metaAudienceCommand).where(eq(metaAudienceCommand.commandId, commandId)).limit(1); return row ? { ...toRecord(row), ...(row.expiresAt <= new Date() ? { expired: true } : {}) } : undefined; },
    async complete(commandId, result) { await db.update(metaAudienceCommand).set({ status: "completed", result, updatedAt: new Date() }).where(eq(metaAudienceCommand.commandId, commandId)); },
    async markUncertain(commandId) { await db.update(metaAudienceCommand).set({ status: "uncertain", updatedAt: new Date() }).where(eq(metaAudienceCommand.commandId, commandId)); },
  };
}
