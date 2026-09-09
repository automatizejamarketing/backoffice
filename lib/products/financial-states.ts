/** Canonical product financial state vocabulary shared by schema and policies. */

export const PRODUCT_ORDER_STATUS_VALUES = [
  "pending",
  "approved",
  "failed",
  "canceled",
  "refunded",
] as const;
export type ProductOrderStatus = (typeof PRODUCT_ORDER_STATUS_VALUES)[number];

export const PRODUCT_PAYMENT_STATUS_VALUES = [
  "pending",
  "approved",
  "failed",
  "refunded",
  "charged_back",
] as const;
export type ProductPaymentStatus = (typeof PRODUCT_PAYMENT_STATUS_VALUES)[number];

export const PRODUCT_PAYMENT_ATTEMPT_STATUS_VALUES = [
  "prepared",
  "issuing",
  "pending",
  "approved",
  "failed",
  "expired",
  "unknown",
  "abandoned",
] as const;
export type ProductPaymentAttemptStatus =
  (typeof PRODUCT_PAYMENT_ATTEMPT_STATUS_VALUES)[number];

export const PRODUCT_REFUND_REQUEST_STATUS_VALUES = [
  "requested",
  "in_review",
  "completed",
  "declined",
] as const;
export type ProductRefundRequestStatus = (typeof PRODUCT_REFUND_REQUEST_STATUS_VALUES)[number];

export const PRODUCT_REFUND_OPERATION_STATUS_VALUES = [
  "issuing",
  "confirmed",
  "failed",
  "external_partial",
] as const;
export type ProductRefundOperationStatus = (typeof PRODUCT_REFUND_OPERATION_STATUS_VALUES)[number];

export const PRODUCT_REFUND_BALANCE_RESPONSIBLE_VALUES = ["expert", "automatize"] as const;
export type ProductRefundBalanceResponsible = (typeof PRODUCT_REFUND_BALANCE_RESPONSIBLE_VALUES)[number];

export const PRODUCT_REFUND_BALANCE_CASE_STATUS_VALUES = ["pending", "resolved"] as const;
export type ProductRefundBalanceCaseStatus = (typeof PRODUCT_REFUND_BALANCE_CASE_STATUS_VALUES)[number];

export const PRODUCT_FINANCIAL_RESPONSIBLE_VALUES = ["expert", "automatize"] as const;
export type ProductFinancialResponsible = (typeof PRODUCT_FINANCIAL_RESPONSIBLE_VALUES)[number];

export const PRODUCT_CARD_DISPUTE_STATUS_VALUES = [
  "open_full",
  "open_partial",
  "closed_valid",
  "closed_revoked",
  "closed_partial",
] as const;
export type ProductCardDisputeStatus = (typeof PRODUCT_CARD_DISPUTE_STATUS_VALUES)[number];

export const PRODUCT_PIX_FRAUD_CASE_STATUS_VALUES = [
  "under_review",
  "closed_valid",
  "payment_invalidated_by_fraud",
] as const;
export type ProductPixFraudCaseStatus = (typeof PRODUCT_PIX_FRAUD_CASE_STATUS_VALUES)[number];

export const PRODUCT_RECONCILIATION_CASE_KIND_VALUES = [
  "lost_event",
  "account_divergence",
  "amount_divergence",
  "currency_divergence",
  "conflicting_data",
  "split_divergence",
  "external_partial_refund",
] as const;
export type ProductReconciliationCaseKind = (typeof PRODUCT_RECONCILIATION_CASE_KIND_VALUES)[number];

export const PRODUCT_RECONCILIATION_RESPONSIBLE_VALUES = [
  "operations",
  "automatize_finance",
  "expert",
] as const;
export type ProductReconciliationResponsible = (typeof PRODUCT_RECONCILIATION_RESPONSIBLE_VALUES)[number];

export const PRODUCT_RECONCILIATION_CASE_STATUS_VALUES = ["open", "monitoring", "resolved"] as const;
export type ProductReconciliationCaseStatus = (typeof PRODUCT_RECONCILIATION_CASE_STATUS_VALUES)[number];

export const PRODUCT_POST_SALE_REVERSAL_VALUES = [
  "integral_refund",
  "lost_full_chargeback",
  "external_partial",
  "pix_med",
] as const;
export type ProductPostSaleReversal = (typeof PRODUCT_POST_SALE_REVERSAL_VALUES)[number];

export const PRODUCT_POST_SALE_COST_STATUS_VALUES = ["open", "exception", "settled"] as const;
export type ProductPostSaleCostStatus = (typeof PRODUCT_POST_SALE_COST_STATUS_VALUES)[number];

export const PRODUCT_POST_SALE_MOVEMENT_KIND_VALUES = ["cost", "credit"] as const;
export type ProductPostSaleMovementKind = (typeof PRODUCT_POST_SALE_MOVEMENT_KIND_VALUES)[number];

export const PRODUCT_POST_SALE_MOVEMENT_ATTRIBUTION_VALUES = ["common", "specific"] as const;
export type ProductPostSaleMovementAttribution = (typeof PRODUCT_POST_SALE_MOVEMENT_ATTRIBUTION_VALUES)[number];

export const PRODUCT_EXPERT_LEDGER_ENTRY_TYPE_VALUES = ["sale", "refund", "chargeback", "payout"] as const;
export type ProductExpertLedgerEntryType = (typeof PRODUCT_EXPERT_LEDGER_ENTRY_TYPE_VALUES)[number];

export const PRODUCT_EXPERT_PAYOUT_STATUS_VALUES = [
  "requested",
  "approved",
  "paid",
  "rejected",
  "canceled",
] as const;
export type ProductExpertPayoutStatus = (typeof PRODUCT_EXPERT_PAYOUT_STATUS_VALUES)[number];
