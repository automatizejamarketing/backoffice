import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { vindiPaymentLink } from "@/lib/db/schema";
import type {
  BackofficeVindiPixStore,
  StoredBackofficeVindiPixLink,
} from "./backoffice-pix-charge";

function toStored(
  row: typeof vindiPaymentLink.$inferSelect,
): StoredBackofficeVindiPixLink {
  return {
    id: row.id,
    userId: row.userId,
    planType: row.planType,
    amount: row.amount,
    currency: row.currency,
    emvPayload: row.emvPayload,
    vindiBillId: row.vindiBillId,
    vindiChargeId: row.vindiChargeId,
    status: row.status,
    source: row.source,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDbBackofficeVindiPixStore(): BackofficeVindiPixStore {
  return {
    async listOpenLinks(userId) {
      const rows = await db
        .select()
        .from(vindiPaymentLink)
        .where(
          and(
            eq(vindiPaymentLink.userId, userId),
            eq(vindiPaymentLink.purpose, "subscription"),
            eq(vindiPaymentLink.status, "pending"),
          ),
        )
        .orderBy(desc(vindiPaymentLink.createdAt));
      return rows.map(toStored);
    },
    async persistLink(input) {
      const [row] = await db
        .insert(vindiPaymentLink)
        .values({
          userId: input.userId,
          purpose: "subscription",
          planType: input.planType,
          amount: input.amount,
          currency: "brl",
          emvPayload: input.emvPayload,
          vindiBillId: input.vindiBillId,
          vindiChargeId: input.vindiChargeId,
          status: "pending",
          source: "backoffice",
          expiresAt: input.expiresAt,
        })
        .returning();
      if (!row) throw new Error("Falha ao salvar o Pix Vindi.");
      return toStored(row);
    },
    async markLinksSuperseded(ids, now) {
      if (ids.length === 0) return;
      await db
        .update(vindiPaymentLink)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(vindiPaymentLink.status, "pending"),
            inArray(vindiPaymentLink.id, ids),
          ),
        );
    },
  };
}
