import "server-only";

import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { PLAN_GRACE_DAYS } from "./plan-core";

/**
 * Estende a expiração das contas dos clientes até o "pago até" do plano + carência (ADR 0046). É a
 * mesma coluna que libera o app para quem assina: o cliente coberto entra e conecta o Instagram sem
 * plano próprio. Nunca encurta (quem paga por conta própria não perde dias) e audita cada conta.
 */
export async function applyAgencyCoverage(tx: Pick<typeof db, "execute">, agencyId: string, by: string, userId?: string) {
  await tx.execute(sql`
    WITH plan AS (
      SELECT plan_paid_until + make_interval(days => ${PLAN_GRACE_DAYS}) AS until
      FROM agencies WHERE id = ${agencyId} AND plan_paid_until IS NOT NULL
    ), targets AS MATERIALIZED (
      SELECT u.id, u.expiration_date AS old, plan.until
      FROM users u
      JOIN agency_clients c ON c.user_id = u.id
      CROSS JOIN plan
      WHERE c.agency_id = ${agencyId}
        ${userId ? sql`AND u.id = ${userId}` : sql``}
        AND (u.expiration_date IS NULL OR u.expiration_date < plan.until)
      FOR UPDATE OF u
    ), updated AS (
      UPDATE users SET expiration_date = targets.until
      FROM targets WHERE users.id = targets.id
      RETURNING users.id, targets.old, targets.until
    )
    INSERT INTO backoffice_audit_logs (admin_email, target_user_id, action, field_name, old_value, new_value)
    SELECT ${by}, id, 'agency_plan_coverage', 'expiration_date',
      to_char(old AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      to_char(until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    FROM updated
  `);
}
