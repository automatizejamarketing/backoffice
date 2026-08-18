import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PaymentPurpose } from "@/lib/db/schema";

export const BILLING_PAYMENT_PURPOSES = [
  "subscription",
  "legacy_renewal",
] as const satisfies readonly PaymentPurpose[];

function billingPurposeListSql() {
  return sql.raw(
    BILLING_PAYMENT_PURPOSES.map((purpose) => `'${purpose}'`).join(", "),
  );
}

export function billingPaymentPurposeSql(
  purposeColumn: string | SQLWrapper = "p.purpose",
): SQL {
  const column =
    typeof purposeColumn === "string" ? sql.raw(purposeColumn) : purposeColumn;
  return sql`(${column} is null or ${column} in (${billingPurposeListSql()}))`;
}

export function isBillingPaymentPurpose(
  purpose: PaymentPurpose | null | undefined,
): boolean {
  return (
    purpose == null ||
    (BILLING_PAYMENT_PURPOSES as readonly PaymentPurpose[]).includes(purpose)
  );
}
