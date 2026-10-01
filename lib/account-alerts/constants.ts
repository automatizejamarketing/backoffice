/** Account-state alerts for the assigned consultant. Distinct from playbook.*. */
export const ACCOUNT_ALERTS_RULE_PREFIX = "account.";

export const ACCOUNT_ALERTS_RULEBOOK_VERSION = "account-attention@1";

export const ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN = "account.no_active_campaign";
export const ACCOUNT_RULE_PIX_EXPIRING = "account.pix_expiring";
export const ACCOUNT_RULE_CARD_PAYMENT_FAILED = "account.card_payment_failed";
export const ACCOUNT_RULE_RECENTLY_CANCELED = "account.recently_canceled";

export const ACCOUNT_ALERT_RULE_IDS = [
  ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN,
  ACCOUNT_RULE_PIX_EXPIRING,
  ACCOUNT_RULE_CARD_PAYMENT_FAILED,
  ACCOUNT_RULE_RECENTLY_CANCELED,
] as const;

export type AccountAlertRuleId = (typeof ACCOUNT_ALERT_RULE_IDS)[number];

export const ACCOUNT_ALERTS_WINDOW = "current";

/** SQL prefilter. Wider than the configurable lookbacks so a threshold change still sees the row. */
export const ACCOUNT_ALERT_LOAD_LOOKBACK_DAYS = 120;
