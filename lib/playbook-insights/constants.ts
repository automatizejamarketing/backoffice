/** Rulebook identity for consultant-facing playbook optimization suggestions. */
export const PLAYBOOK_INSIGHTS_RULEBOOK_VERSION = "food-service-playbook@2";

/** Insights written by this job use this rule id prefix. */
export const PLAYBOOK_INSIGHTS_RULE_PREFIX = "playbook.";

export const PLAYBOOK_RULE_ROAS_TRIGGER = "playbook.roas_trigger";
export const PLAYBOOK_RULE_ROAS_SCALE = "playbook.roas_scale";
export const PLAYBOOK_RULE_CPA_ALERT = "playbook.cpa_alert";
export const PLAYBOOK_RULE_STALLED = "playbook.campaign_stalled";
export const PLAYBOOK_RULE_NO_DELIVERY = "playbook.no_delivery";

export const PLAYBOOK_INSIGHTS_WINDOW = "last_30d" as const;

/** Trailing calendar days (including today) used for recent-spend eligibility. */
export const PLAYBOOK_RECENT_SPEND_DAYS = 10;

/** Minimum spend (account currency) before ROAS/CPA rules fire. */
export const PLAYBOOK_MIN_SPEND = 50;

/** ROAS ≤ this → trigger analysis (playbook §12). */
export const PLAYBOOK_ROAS_TRIGGER = 3;
/** ROAS ≥ this → validated / scale opportunity. */
export const PLAYBOOK_ROAS_VALIDATED = 5;

/** Default ticket médio when company ticket is unknown (CPA table R$50 band). */
export const PLAYBOOK_DEFAULT_TICKET_MEDIO = 50;
/** CPA alert threshold for default ticket band (playbook §13). */
export const PLAYBOOK_DEFAULT_CPA_ALERT = 7.5;

/** Paused untouched for this many days → stalled. */
export const PLAYBOOK_STALLED_DAYS = 5;
export const PLAYBOOK_MIN_SPEND_STALLED = 30;

export const PLAYBOOK_INSIGHTS_TIME_ZONE = "America/Sao_Paulo";

/** Cron: users claimed per invocation. */
export const PLAYBOOK_INSIGHTS_CLAIM_BATCH_SIZE = 25;
