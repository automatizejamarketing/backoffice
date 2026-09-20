import assert from "node:assert/strict";
import test from "node:test";
import * as bunTest from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  BackofficePixRetentionConflictError,
  backofficePixRetentionConflictResponse,
  isPayableMercadoPagoPixStatus,
  isTerminalMercadoPagoPixStatus,
} from "./pix-retention-contract";

type PlanType = "monthly_starter" | "monthly_pro";
type Link = Record<string, any>;
type Benefit = Record<string, any>;
const mock = (bunTest as any).mock;

class MemoryExecutor {
  user = { id: "user-1", email: "customer@example.com" };
  benefit: Benefit | null = null;
  links: Link[] = [];
  lockOrder: string[] = [];
  postCalls: Array<Record<string, unknown>> = [];
  linkPredicateSql = "";
  private transactionTail = Promise.resolve();

  tableName(table: any) {
    const symbol = Object.getOwnPropertySymbols(table ?? {}).find((item) =>
      String(item) === "Symbol(drizzle:Name)",
    );
    return symbol ? table[symbol] : table?._?.name ?? table?.name ?? "";
  }

  async transaction<T>(callback: (executor: this) => Promise<T>): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => turn);
    await previous;
    try {
      return await callback(this);
    } finally {
      release();
    }
  }

  select = () => {
    const query: any = {
      name: "",
      condition: null as unknown,
      from: (table: any) => {
        query.name = this.tableName(table);
        return query;
      },
      where: (condition: unknown) => {
        query.condition = condition;
        return query;
      },
      limit: () => query,
      orderBy: () => query,
      for: () => {
        this.lockOrder.push(query.name);
        return query;
      },
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
        let rows: unknown[] = [];
        if (query.name === "users") rows = [this.user];
        if (query.name === "retention_financial_benefits") {
          rows = this.benefit ? [this.benefit] : [];
        }
        if (query.name === "subscriptions") rows = [];
        if (query.name === "mercadopago_payment_links") {
          const compiled = query.condition
            ? new PgDialect().sqlToQuery(query.condition)
            : { sql: "", params: [] };
          this.linkPredicateSql = compiled.sql;
          const userId = compiled.params[0];
          const statuses = compiled.params.slice(1);
          rows = this.links.filter(
            (link) =>
              link.userId === userId &&
              (statuses.length === 0 || statuses.includes(link.status)),
          );
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return query;
  };

  insert = () => {
    const query: any = {
      values: (values: Link) => {
        const row = {
          ...values,
          createdAt: values.createdAt ?? new Date(),
          updatedAt: values.updatedAt ?? new Date(),
          paidAt: values.paidAt ?? null,
          retentionBenefitId: values.retentionBenefitId ?? null,
          originalAmount: values.originalAmount ?? null,
          discountPercent: values.discountPercent ?? null,
          discountAmount: values.discountAmount ?? null,
        };
        this.links.push(row);
        query.row = row;
        return query;
      },
      returning: async () => [query.row],
    };
    return query;
  };

  update = (table: any) => {
    const query: any = {
      values: null,
      set: (values: Record<string, unknown>) => {
        query.values = values;
        return query;
      },
      where: () => query,
      returning: async () => {
        const rows = this.tableName(table) === "retention_financial_benefits"
          ? this.benefit ? [this.benefit] : []
          : this.links;
        for (const row of rows) Object.assign(row, query.values);
        return rows;
      },
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        query.returning().then(resolve, reject),
    };
    return query;
  };
}

const memory = new MemoryExecutor();

mock.module("server-only", () => ({}));
mock.module("date-fns", () => ({
  addDays: (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000),
  addMonths: (date: Date, months: number) => new Date(date.getTime() + months * 30 * 86_400_000),
  addYears: (date: Date, years: number) => new Date(date.getTime() + years * 365 * 86_400_000),
}));
mock.module("resend", () => ({ Resend: class { emails = { send: async () => ({ error: null }) }; } }));
mock.module("@/lib/db", () => ({ db: memory }));
mock.module("@/lib/backoffice/datetime-format", () => ({ formatInSaoPaulo: () => "20/09/2026" }));
mock.module("@/lib/mercadopago/pix-payment", () => ({
  getMercadoPagoPixPayment: async () => null,
  cancelMercadoPagoPixPayment: async () => ({ status: "cancelled" }),
  createMercadoPagoPixPayment: async () => ({ paymentId: "mock", pixCopyPasteCode: "mock" }),
  isPayableMercadoPagoPixStatus,
  isTerminalMercadoPagoPixStatus,
}));

const { createOrReuseBackofficePixLink, serializeBackofficePixLink } =
  await import("./pix");

function provider(overrides: {
  status?: string;
  create?: (input: Record<string, unknown>) => Promise<Record<string, string>>;
  get?: (paymentId: string) => Promise<Record<string, unknown> | null>;
}): any {
  let sequence = 0;
  return {
    getPayment: overrides.get ?? (async () => null),
    cancelPayment: async () => ({ status: "cancelled" }),
    createPayment: overrides.create ?? (async (input) => {
      memory.postCalls.push(input);
      sequence += 1;
      return { paymentId: `mp-${sequence}`, pixCopyPasteCode: `code-${sequence}` };
    }),
  };
}

function reset() {
  memory.benefit = null;
  memory.links = [];
  memory.lockOrder = [];
  memory.postCalls = [];
  memory.linkPredicateSql = "";
  (process.env as Record<string, string>).NODE_ENV = "development";
  process.env.MERCADOPAGO_PIX_TEST_AMOUNT_CENTAVOS = "120000";
}

const baseBenefit = () => ({
  id: "benefit-1",
  userId: "user-1",
  status: "reserved",
  provider: "mercadopago",
  planType: "monthly_starter" as PlanType,
  originalAmount: 120000,
  discountPercent: 25,
  discountAmount: 30000,
  providerPaymentId: null,
});

test("generator creates regular full price when there is no benefit", async () => {
  reset();
  const result = await createOrReuseBackofficePixLink({
    userId: "user-1",
    planType: "monthly_starter",
    adminEmail: "admin@example.com",
    executor: memory as any,
    provider: provider({}),
  });
  assert.equal(result.amount, 120000);
  assert.equal(result.retentionBenefitId, null);
  assert.equal(memory.postCalls.length, 1);
});

test("reserved benefit creates one discounted payment with snapshot and idempotency metadata", async () => {
  reset();
  memory.benefit = baseBenefit();
  const calls: Record<string, unknown>[] = [];
  const result = await createOrReuseBackofficePixLink({
    userId: "user-1",
    planType: "monthly_starter",
    adminEmail: "admin@example.com",
    executor: memory as any,
    provider: provider({
      create: async (input) => {
        calls.push(input);
        return { paymentId: "mp-discount", pixCopyPasteCode: "discount-code" };
      },
    }),
  });
  assert.equal(result.amount, 90000);
  assert.equal(result.originalAmountCentavos, 120000);
  assert.equal(result.discountAmountCentavos, 30000);
  assert.equal(result.retentionBenefitId, "benefit-1");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.providerIdempotencyKey), /^retention-pix:benefit-1:/);
  assert.equal(calls[0]?.retentionBenefitId, "benefit-1");
  assert.equal(calls[0]?.originalAmountCentavos, 120000);
  assert.equal(calls[0]?.discountAmountCentavos, 30000);
  assert.deepEqual(memory.lockOrder.slice(0, 3), ["users", "retention_financial_benefits", "mercadopago_payment_links"]);
});

test("local expired discounted link with provider payable is reused", async () => {
  reset();
  memory.benefit = baseBenefit();
  memory.links = [{
    id: "link-expired",
    userId: "user-1",
    planType: "monthly_starter",
    amount: 90000,
    status: "expired",
    retentionBenefitId: "benefit-1",
    originalAmount: 120000,
    discountPercent: 25,
    discountAmount: 30000,
    mercadopagoPaymentId: "mp-existing",
    pixCopyPaste: "old-code",
    source: "self_service",
  }];
  const result = await createOrReuseBackofficePixLink({
    userId: "user-1", planType: "monthly_starter", adminEmail: "admin@example.com",
    executor: memory as any,
    provider: provider({ get: async () => ({ status: "authorized", transaction_amount: 900 }) }),
  });
  assert.equal(result.reused, true);
  assert.equal(result.amount, 90000);
  assert.equal(memory.postCalls.length, 0);
});

test("approved and missing identity discounted links require reconciliation", async () => {
  reset();
  memory.benefit = baseBenefit();
  memory.links = [{ id: "paid", userId: "user-1", planType: "monthly_starter", amount: 90000, status: "pending", retentionBenefitId: "benefit-1", mercadopagoPaymentId: "mp-paid" }];
  await assert.rejects(
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({ get: async () => ({ status: "approved" }) }) }),
    (error: unknown) => error instanceof BackofficePixRetentionConflictError && error.code === "retention_payment_paid",
  );
  assert.equal(memory.postCalls.length, 0);
  reset();
  memory.benefit = baseBenefit();
  memory.links = [{ id: "missing-cross-plan", userId: "user-1", planType: "monthly_pro", amount: 90000, status: "pending", retentionBenefitId: "benefit-1", mercadopagoPaymentId: null }];
  await assert.rejects(
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({}) }),
    (error: unknown) => error instanceof BackofficePixRetentionConflictError && error.code === "retention_reconciliation_required",
  );
});

test("terminal discounted payment is replaced once with a new idempotency key", async () => {
  reset();
  memory.benefit = baseBenefit();
  memory.links = [{ id: "old", userId: "user-1", planType: "monthly_starter", amount: 90000, status: "expired", retentionBenefitId: "benefit-1", mercadopagoPaymentId: "mp-old", pixCopyPaste: "old" }];
  const result = await createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({ get: async () => ({ status: "expired" }) }) });
  assert.equal(result.reused, false);
  assert.equal(memory.postCalls.length, 1);
  assert.match(String(memory.postCalls[0]?.providerIdempotencyKey), /^retention-pix:benefit-1:/);
  assert.notEqual(result.id, "old");
});

test("consumed benefit allows normal price only when no discounted row is unresolved", async () => {
  reset();
  memory.benefit = { ...baseBenefit(), status: "consumed", providerPaymentId: "mp-consumed" };
  const result = await createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({}) });
  assert.equal(result.amount, 120000);
  reset();
  memory.benefit = { ...baseBenefit(), status: "consumed", providerPaymentId: "mp-consumed" };
  memory.links = [{ id: "historical-terminal", userId: "user-1", planType: "monthly_pro", amount: 90000, status: "expired", retentionBenefitId: "old-benefit", mercadopagoPaymentId: "mp-terminal" }];
  const terminalResult = await createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({ get: async () => ({ status: "expired" }) }) });
  assert.equal(terminalResult.amount, 120000);
  assert.equal(memory.linkPredicateSql.includes("plan_type"), false);
  reset();
  memory.benefit = { ...baseBenefit(), status: "consumed", providerPaymentId: "mp-consumed" };
  memory.links = [{ id: "historical-payable", userId: "user-1", planType: "monthly_pro", amount: 90000, status: "pending", retentionBenefitId: "old-benefit", mercadopagoPaymentId: "mp-payable" }];
  await assert.rejects(
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({ get: async () => ({ status: "pending" }) }) }),
    (error: unknown) => error instanceof BackofficePixRetentionConflictError && error.code === "retention_provider_mismatch",
  );
  reset();
  memory.benefit = { ...baseBenefit(), status: "consumed", providerPaymentId: "mp-consumed" };
  memory.links = [{ id: "uncertain", userId: "user-1", planType: "monthly_pro", amount: 90000, status: "pending", retentionBenefitId: "benefit-1", mercadopagoPaymentId: null }];
  await assert.rejects(
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: provider({}) }),
    (error: unknown) => error instanceof BackofficePixRetentionConflictError && error.code === "retention_reconciliation_required",
  );
});

test("concurrent generator calls serialize on the shared transaction lock", async () => {
  reset();
  let posts = 0;
  const fakeProvider = provider({
    get: async () => ({ status: "pending", point_of_interaction: { transaction_data: { qr_code: "code" } } }),
    create: async (input) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { paymentId: `mp-${posts}`, pixCopyPasteCode: "code" };
    },
  });
  const [first, second] = await Promise.all([
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: fakeProvider }),
    createOrReuseBackofficePixLink({ userId: "user-1", planType: "monthly_starter", adminEmail: "a", executor: memory as any, provider: fakeProvider }),
  ]);
  assert.equal(posts, 1);
  assert.equal(first.id, second.id);
  assert.equal(second.reused, true);
});

test("a frontend-style user lock participant serializes before backoffice generation", async () => {
  reset();
  const frontendContract = memory.transaction(async (tx) => {
    tx.lockOrder.push("frontend:users");
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  const backofficeContract = createOrReuseBackofficePixLink({
    userId: "user-1",
    planType: "monthly_starter",
    adminEmail: "a",
    executor: memory as any,
    provider: provider({}),
  });
  await Promise.all([frontendContract, backofficeContract]);
  assert.equal(memory.lockOrder[0], "frontend:users");
  assert.equal(memory.postCalls.length, 1);
});

test("route serialization exposes the actual discounted amount and snapshots", () => {
  const payload = serializeBackofficePixLink({
    id: "link",
    planType: "monthly_starter",
    amount: 90000,
    originalAmount: 120000,
    discountPercent: 25,
    discountAmount: 30000,
    retentionBenefitId: "benefit-1",
    currency: "brl",
    preferenceId: "link",
    initPoint: "code",
    pixCopyPaste: "code",
    pixCopyPasteCode: "code",
    mercadopagoPaymentId: "mp",
    status: "pending",
    source: "backoffice",
    adminEmail: "a",
    expiresAt: new Date("2026-09-27T00:00:00Z"),
    createdAt: new Date("2026-09-20T00:00:00Z"),
    reused: false,
    originalAmountCentavos: 120000,
    discountAmountCentavos: 30000,
    finalAmountCentavos: 90000,
  } as any);
  assert.equal(payload.amount, 90000);
  assert.equal(payload.originalAmount, 120000);
  assert.equal(payload.discountAmount, 30000);
  assert.equal(payload.finalAmount, 90000);
  assert.equal(payload.retentionBenefitId, "benefit-1");
});

test("route conflict seam returns machine-readable HTTP 409", () => {
  const response = backofficePixRetentionConflictResponse(
    new BackofficePixRetentionConflictError(
      "retention_reconciliation_required",
      "Provider status is uncertain",
      { providerPaymentId: "mp-1" },
    ),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: "Provider status is uncertain",
    code: "retention_reconciliation_required",
    details: { providerPaymentId: "mp-1" },
  });
});
