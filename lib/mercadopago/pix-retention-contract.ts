export type BackofficePixRetentionConflictCode =
  | "retention_reconciliation_required"
  | "retention_payment_paid"
  | "retention_snapshot_mismatch"
  | "retention_provider_mismatch";

export class BackofficePixRetentionConflictError extends Error {
  readonly code: BackofficePixRetentionConflictCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: BackofficePixRetentionConflictCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BackofficePixRetentionConflictError";
    this.code = code;
    this.details = details;
  }
}

export function calculateRetentionPixAmounts({
  originalAmountCentavos,
  discountPercent,
  discountAmountCentavos,
}: {
  originalAmountCentavos: number;
  discountPercent: number;
  discountAmountCentavos: number;
}) {
  if (
    !Number.isSafeInteger(originalAmountCentavos) ||
    originalAmountCentavos <= 0 ||
    !Number.isSafeInteger(discountPercent) ||
    discountPercent <= 0 ||
    discountPercent > 100
  ) {
    throw new BackofficePixRetentionConflictError(
      "retention_snapshot_mismatch",
      "Retention benefit amount snapshot is invalid",
    );
  }
  const expectedDiscount = Math.round(
    (originalAmountCentavos * discountPercent) / 100,
  );
  if (expectedDiscount !== discountAmountCentavos) {
    throw new BackofficePixRetentionConflictError(
      "retention_snapshot_mismatch",
      "Retention benefit amount snapshot does not match its campaign",
    );
  }
  return {
    originalAmountCentavos,
    discountAmountCentavos,
    finalAmountCentavos: originalAmountCentavos - discountAmountCentavos,
  };
}

export function isPayableMercadoPagoPixStatus(
  status: string | undefined,
): boolean {
  return (
    status === "pending" ||
    status === "in_process" ||
    status === "authorized"
  );
}

export function isTerminalMercadoPagoPixStatus(
  status: string | undefined,
): boolean {
  return (
    status === "cancelled" ||
    status === "canceled" ||
    status === "expired" ||
    status === "rejected"
  );
}

export type RetentionProviderSnapshot = {
  status?: string;
  transactionAmountCentavos?: number;
  pixCopyPasteCode?: string | null;
};

export type RetentionProviderResolution =
  | { kind: "reuse"; pixCopyPasteCode: string }
  | { kind: "replace" };

/**
 * Provider-only state machine used by the database generator. Keeping this
 * decision pure makes the dangerous paid/pending/unknown branches testable
 * without a Mercado Pago request or a Postgres connection.
 */
export async function resolveRetentionPixProviderState({
  provider,
  linkId,
  linkBenefitId,
  benefitId,
  linkAmountCentavos,
  expectedAmountCentavos,
  pixCopyPasteCode,
  cancel,
}: {
  provider: RetentionProviderSnapshot | null;
  linkId: string;
  linkBenefitId: string | null;
  benefitId: string;
  linkAmountCentavos: number;
  expectedAmountCentavos: number;
  pixCopyPasteCode?: string | null;
  cancel?: () => Promise<RetentionProviderSnapshot>;
}): Promise<RetentionProviderResolution> {
  if (!provider) {
    throw new BackofficePixRetentionConflictError(
      "retention_reconciliation_required",
      "Mercado Pago payment could not be found",
      { linkId },
    );
  }
  if (provider.status === "approved") {
    throw new BackofficePixRetentionConflictError(
      "retention_payment_paid",
      "A Mercado Pago renewal was paid and must be settled before retrying",
      { linkId },
    );
  }
  if (isPayableMercadoPagoPixStatus(provider.status)) {
    if (linkBenefitId === benefitId) {
      if (
        linkAmountCentavos !== expectedAmountCentavos ||
        (provider.transactionAmountCentavos !== undefined &&
          provider.transactionAmountCentavos !== expectedAmountCentavos)
      ) {
        throw new BackofficePixRetentionConflictError(
          "retention_snapshot_mismatch",
          "Mercado Pago payment amount does not match the retention snapshot",
          { linkId },
        );
      }
      const code = provider.pixCopyPasteCode ?? pixCopyPasteCode;
      if (!code) {
        throw new BackofficePixRetentionConflictError(
          "retention_reconciliation_required",
          "Payable Mercado Pago payment has no Pix code",
          { linkId },
        );
      }
      return { kind: "reuse", pixCopyPasteCode: code };
    }
    if (!cancel) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Another discounted Pix is still payable",
        { linkId },
      );
    }
    const cancelled = await cancel();
    if (!isTerminalMercadoPagoPixStatus(cancelled.status)) {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Mercado Pago cancellation result is not terminal",
        { linkId, providerStatus: cancelled.status },
      );
    }
    return { kind: "replace" };
  }
  if (isTerminalMercadoPagoPixStatus(provider.status)) return { kind: "replace" };
  throw new BackofficePixRetentionConflictError(
    "retention_reconciliation_required",
    "Mercado Pago returned an unknown payment status",
    { linkId, providerStatus: provider.status },
  );
}

export function canIssueRegularPixAfterRetention({
  benefitStatus,
  payableDiscountedLink,
}: {
  benefitStatus: "reserved" | "applying" | "reconciliation_required" | "applied" | "consumed" | null;
  payableDiscountedLink: boolean;
}): boolean {
  if (payableDiscountedLink) return false;
  return benefitStatus === null || benefitStatus === "consumed";
}
