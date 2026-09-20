import assert from "node:assert/strict";
import test from "node:test";
import {
  BackofficePixRetentionConflictError,
  calculateRetentionPixAmounts,
  canIssueRegularPixAfterRetention,
  isPayableMercadoPagoPixStatus,
  resolveRetentionPixProviderState,
} from "./pix-retention-contract";

test("retention Pix keeps the stored whole-period amount snapshot", () => {
  assert.deepEqual(
    calculateRetentionPixAmounts({
      originalAmountCentavos: 120_000,
      discountPercent: 25,
      discountAmountCentavos: 30_000,
    }),
    {
      originalAmountCentavos: 120_000,
      discountAmountCentavos: 30_000,
      finalAmountCentavos: 90_000,
    },
  );
});

test("only provider payable states may reuse a retention Pix", () => {
  assert.equal(isPayableMercadoPagoPixStatus("pending"), true);
  assert.equal(isPayableMercadoPagoPixStatus("in_process"), true);
  assert.equal(isPayableMercadoPagoPixStatus("authorized"), true);
  assert.equal(isPayableMercadoPagoPixStatus("approved"), false);
  assert.equal(isPayableMercadoPagoPixStatus("expired"), false);
});

test("retention conflicts carry a stable reconciliation code", () => {
  const error = new BackofficePixRetentionConflictError(
    "retention_reconciliation_required",
    "Mercado Pago payment status is unknown",
    { providerPaymentId: "mp-1" },
  );

  assert.equal(error.code, "retention_reconciliation_required");
  assert.equal(error.details.providerPaymentId, "mp-1");
});

test("a payable discounted link is reused without creating another payment", async () => {
  let cancellations = 0;
  const result = await resolveRetentionPixProviderState({
    provider: {
      status: "authorized",
      transactionAmountCentavos: 90_000,
      pixCopyPasteCode: "pix-code",
    },
    linkId: "link-1",
    linkBenefitId: "benefit-1",
    benefitId: "benefit-1",
    linkAmountCentavos: 90_000,
    expectedAmountCentavos: 90_000,
    cancel: async () => {
      cancellations += 1;
      return { status: "cancelled" };
    },
  });

  assert.deepEqual(result, { kind: "reuse", pixCopyPasteCode: "pix-code" });
  assert.equal(cancellations, 0);
});

test("a paid or unknown provider state requires reconciliation", async () => {
  await assert.rejects(
    resolveRetentionPixProviderState({
      provider: { status: "approved" },
      linkId: "link-paid",
      linkBenefitId: "benefit-1",
      benefitId: "benefit-1",
      linkAmountCentavos: 90_000,
      expectedAmountCentavos: 90_000,
    }),
    (error: unknown) =>
      error instanceof BackofficePixRetentionConflictError &&
      error.code === "retention_payment_paid",
  );
  await assert.rejects(
    resolveRetentionPixProviderState({
      provider: { status: "mystery" },
      linkId: "link-unknown",
      linkBenefitId: "benefit-1",
      benefitId: "benefit-1",
      linkAmountCentavos: 90_000,
      expectedAmountCentavos: 90_000,
    }),
    (error: unknown) =>
      error instanceof BackofficePixRetentionConflictError &&
      error.code === "retention_reconciliation_required",
  );
});

test("regular Pix is forbidden over a pending discounted reservation", () => {
  assert.equal(
    canIssueRegularPixAfterRetention({
      benefitStatus: "consumed",
      payableDiscountedLink: true,
    }),
    false,
  );
  assert.equal(
    canIssueRegularPixAfterRetention({
      benefitStatus: "consumed",
      payableDiscountedLink: false,
    }),
    true,
  );
});

test("a provider terminal state permits one replacement generation", async () => {
  const result = await resolveRetentionPixProviderState({
    provider: { status: "expired" },
    linkId: "link-expired",
    linkBenefitId: "benefit-1",
    benefitId: "benefit-1",
    linkAmountCentavos: 90_000,
    expectedAmountCentavos: 90_000,
  });
  assert.deepEqual(result, { kind: "replace" });
});

test("a pending link from another reservation is canceled before replacement", async () => {
  let cancellations = 0;
  const result = await resolveRetentionPixProviderState({
    provider: { status: "in_process" },
    linkId: "link-other",
    linkBenefitId: "other-benefit",
    benefitId: "benefit-1",
    linkAmountCentavos: 90_000,
    expectedAmountCentavos: 90_000,
    cancel: async () => {
      cancellations += 1;
      return { status: "cancelled" };
    },
  });
  assert.deepEqual(result, { kind: "replace" });
  assert.equal(cancellations, 1);
});
