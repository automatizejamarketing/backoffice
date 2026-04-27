import { endOfDay, isValid, parse } from "date-fns";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeAuditLog,
  creditTransaction,
  user,
} from "@/lib/db/schema";

function expirationInputToEndOfDay(input: string): Date {
  const datePart = input.trim().split("T")[0];
  const fromYmd = parse(datePart, "yyyy-MM-dd", new Date());
  if (isValid(fromYmd)) {
    return endOfDay(fromYmd);
  }
  const fallback = new Date(input);
  if (Number.isNaN(fallback.getTime())) {
    throw new Error("Invalid date");
  }
  return endOfDay(fallback);
}

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

  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!existingUser) {
    return { ok: false as const, error: "User not found" as const };
  }

  const oldVal =
    existingUser.expirationDate?.toISOString() ?? null;
  const newVal = newExpirationDate.toISOString();

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ expirationDate: newExpirationDate })
      .where(eq(user.id, userId));

    await tx.insert(backofficeAuditLog).values({
      adminEmail,
      targetUserId: userId,
      action: "update_expiration_date",
      fieldName: "expiration_date",
      oldValue: oldVal,
      newValue: newVal,
    });
  });

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
