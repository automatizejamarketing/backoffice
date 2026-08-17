import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import type { VindiCustomerDirectory } from "./customer-lookup";

export function createDbVindiCustomerDirectory(): VindiCustomerDirectory {
  return {
    async getCustomerId(userId) {
      const [row] = await db
        .select({ vindiCustomerId: user.vindiCustomerId })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return row?.vindiCustomerId ?? null;
    },
    async saveCustomerId(userId, vindiCustomerId) {
      await db
        .update(user)
        .set({ vindiCustomerId })
        .where(eq(user.id, userId));
    },
  };
}