import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, vindiCustomerLink } from "@/lib/db/schema";
import type {
  VindiCustomerDirectory,
  VindiCustomerRecord,
} from "./customer-lookup";

/**
 * Diretório de Clientes Vindi por par (Conta, CPF) — ADR 0029 no frontend.
 *
 * `users.vindi_customer_id` segue existindo como o Cliente Primário da Conta,
 * e é ele que o índice `users_vindi_customer_id_unique` protege. Não confundir
 * com `users.registry_code`, que é só o último CPF digitado (pré-preenchimento
 * de formulário) — o CPF que vale para cobrança é o da linha de vínculo.
 */
export function createDbVindiCustomerDirectory(): VindiCustomerDirectory {
  return {
    async getPrimary(userId): Promise<VindiCustomerRecord | null> {
      const [linked] = await db
        .select({
          vindiCustomerId: vindiCustomerLink.vindiCustomerId,
          registryCode: vindiCustomerLink.registryCode,
        })
        .from(vindiCustomerLink)
        .where(
          and(
            eq(vindiCustomerLink.userId, userId),
            eq(vindiCustomerLink.isPrimary, true),
          ),
        )
        .limit(1);
      if (linked) {
        return linked;
      }

      // Conta que ganhou Cliente antes do backfill, ou por escrita legada
      // direta em `users`: continua resolvendo, e a próxima gravação cria o
      // vínculo que faltava.
      const [legacy] = await db
        .select({
          vindiCustomerId: user.vindiCustomerId,
          registryCode: user.registryCode,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!legacy?.vindiCustomerId) {
        return null;
      }
      return {
        vindiCustomerId: legacy.vindiCustomerId,
        registryCode: legacy.registryCode,
      };
    },

    async findByRegistryCode(
      userId,
      registryCode,
    ): Promise<VindiCustomerRecord | null> {
      const [row] = await db
        .select({
          vindiCustomerId: vindiCustomerLink.vindiCustomerId,
          registryCode: vindiCustomerLink.registryCode,
        })
        .from(vindiCustomerLink)
        .where(
          and(
            eq(vindiCustomerLink.userId, userId),
            eq(vindiCustomerLink.registryCode, registryCode),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async saveCustomer(input) {
      const now = new Date();
      await db
        .insert(vindiCustomerLink)
        .values({
          userId: input.userId,
          vindiCustomerId: input.vindiCustomerId,
          vindiCode: input.vindiCode,
          registryCode: input.registryCode,
          isPrimary: input.isPrimary,
          lastUsedAt: now,
        })
        .onConflictDoUpdate({
          target: vindiCustomerLink.vindiCustomerId,
          set: {
            vindiCode: input.vindiCode,
            registryCode: input.registryCode,
            isPrimary: input.isPrimary,
            lastUsedAt: now,
          },
        });

      if (input.isPrimary) {
        await db
          .update(user)
          .set({ vindiCustomerId: input.vindiCustomerId })
          .where(eq(user.id, input.userId));
      }
    },
  };
}
