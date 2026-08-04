/** Rulebook / run identity for week-over-week performance drop detection. */
export const PERFORMANCE_DROP_RULEBOOK_VERSION = "performance-drop-v1";

/** Insights written by this job use this rule id prefix. */
export const PERFORMANCE_DROP_RULE_PREFIX = "drop.";

export const PERFORMANCE_DROP_RULE_ROAS = "drop.roas";
export const PERFORMANCE_DROP_RULE_PURCHASES = "drop.purchases";

/** Drop ≥ 30% → warning; ≥ 50% → critical. */
export const PERFORMANCE_DROP_WARNING_RATIO = 0.3;
export const PERFORMANCE_DROP_CRITICAL_RATIO = 0.5;

/**
 * Minimum previous-window spend (account currency) before we trust a drop.
 * Avoids alerting on tiny spend noise.
 */
export const PERFORMANCE_DROP_MIN_PREVIOUS_SPEND = 50;

/** Minimum previous-window purchases before purchase-drop alerts fire. */
export const PERFORMANCE_DROP_MIN_PREVIOUS_PURCHASES = 3;

export const PERFORMANCE_DROP_WINDOW = "last_7d" as const;

export const PERFORMANCE_DROP_TIME_ZONE = "America/Sao_Paulo";
