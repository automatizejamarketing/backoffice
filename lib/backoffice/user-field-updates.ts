import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { expirationInputToEndOfDay } from "./expiration-date";
import {
  backofficeAuditLog,
  creditTransaction,
} from "@/lib/db/schema";

export async function updateUserExpirationWithAudit({
  userId,
  expirationDateInput,
  adminEmail,
}: {
  userId: string;
  expirationDateInput: string;
  adminEmail: string;
}) {
  let newExpirationDate: Date;
  try {
    newExpirationDate = expirationInputToEndOfDay(expirationDateInput);
  } catch {
    return { ok: false as const, error: "invalid_date" as const };
  }

  // One statement keeps the update and audit atomic without sql.begin(), whose
  // connection reservation is skipped by postgres.js when max_pipeline is 0.
  // Lock before reading the old value so concurrent edits keep a correct audit.
  const updated = await db.execute(sql`
    WITH previous AS MATERIALIZED (
      SELECT id, expiration_date FROM users WHERE id = ${userId} FOR UPDATE
    ), updated AS (
      UPDATE users SET expiration_date = ${newExpirationDate.toISOString()}::timestamptz
      FROM previous WHERE users.id = previous.id
      RETURNING users.id, previous.expiration_date AS old_expiration_date
    )
    INSERT INTO backoffice_audit_logs
      (admin_email, target_user_id, action, field_name, old_value, new_value)
    SELECT ${adminEmail}, id, 'update_expiration_date', 'expiration_date',
      to_char(old_expiration_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      ${newExpirationDate.toISOString()}
    FROM updated
    RETURNING target_user_id
  `);

  if (updated.length === 0) {
    return { ok: false as const, error: "User not found" as const };
  }

  return {
    ok: true as const,
    expirationDate: newExpirationDate,
  };
}

export async function adjustUserCreditsWithAudit({
  userId,
  amount,
  adminEmail,
  description,
}: {
  userId: string;
  amount: number;
  adminEmail: string;
  description?: string;
}) {
  if (!Number.isInteger(amount) || amount === 0) {
    return { ok: false as const, error: "amount must be a non-zero integer" as const };
  }

  const result = await db.transaction(async (tx) => {
    // Raw UPDATE bypasses Drizzle's update builder + prepared-query path entirely.
    // Together with postgres `prepare: false` (see lib/db/index.ts), this avoids
    // repeated identical updates returning the same RETURNING row (runtime log evidence).
    const rows = await tx.execute(
      sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`,
    );
    const rowList = rows as unknown as { credits: number }[];
    const updated = rowList[0];

    if (updated === undefined) {
      return { kind: "not_found" as const };
    }

    const newCredits = updated.credits;
    const oldCredits = newCredits - amount;

    await tx.insert(creditTransaction).values({
      userId,
      amount,
      type: "backoffice_adjustment",
      description: description ?? null,
      metadata: { adminEmail },
    });

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: "update_credits",
      fieldName: "credits",
      oldValue: String(oldCredits),
      newValue: String(newCredits),
      note: description ?? null,
    });

    return { kind: "ok" as const, credits: newCredits };
  });

  if (result.kind === "not_found") {
    return { ok: false as const, error: "User not found" as const };
  }

  return { ok: true as const, credits: result.credits };
}
