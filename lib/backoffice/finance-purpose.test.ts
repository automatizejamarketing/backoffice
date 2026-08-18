import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  BILLING_PAYMENT_PURPOSES,
  billingPaymentPurposeSql,
  isBillingPaymentPurpose,
} from "./finance-purpose";

const dialect = new PgDialect();

describe("isBillingPaymentPurpose", () => {
  test("treats null and the billing allowlist as billing", () => {
    expect(isBillingPaymentPurpose(null)).toBe(true);
    expect(isBillingPaymentPurpose(undefined)).toBe(true);
    expect(isBillingPaymentPurpose("subscription")).toBe(true);
    expect(isBillingPaymentPurpose("legacy_renewal")).toBe(true);
  });

  test("excludes store and credit-pack purposes", () => {
    expect(isBillingPaymentPurpose("product")).toBe(false);
    expect(isBillingPaymentPurpose("credit_pack")).toBe(false);
  });
});

describe("billingPaymentPurposeSql", () => {
  test("binds null or the TS allowlist for the default payments alias", () => {
    const { sql: text } = dialect.sqlToQuery(billingPaymentPurposeSql());
    expect(text).toBe(
      `(p.purpose is null or p.purpose in (${BILLING_PAYMENT_PURPOSES.map((purpose) => `'${purpose}'`).join(", ")}))`,
    );
  });

  test("uses the same meaning for another table alias", () => {
    const { sql: text } = dialect.sqlToQuery(
      billingPaymentPurposeSql("earlier_payment.purpose"),
    );
    expect(text).toBe(
      `(earlier_payment.purpose is null or earlier_payment.purpose in (${BILLING_PAYMENT_PURPOSES.map((purpose) => `'${purpose}'`).join(", ")}))`,
    );
  });

  test("accepts a SQL wrapper column", () => {
    const { sql: text } = dialect.sqlToQuery(
      billingPaymentPurposeSql(sql`p.purpose`),
    );
    expect(text).toBe(
      `(p.purpose is null or p.purpose in (${BILLING_PAYMENT_PURPOSES.map((purpose) => `'${purpose}'`).join(", ")}))`,
    );
  });
});
