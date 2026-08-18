/**
 * Objective → result (action_type) glossary.
 *
 * Maps a campaign `objective` (as Meta returns it) to how "the result" should be
 * read from an insights `actions` array — so the agent answers "results" and
 * "cost per result" correctly regardless of objective (system-prompt rule 7).
 *
 * IMPORTANT: the chatbot reads EXISTING campaigns, which may carry either the
 * current ODAX objectives (OUTCOME_*) or LEGACY (pre-ODAX) objectives. Both are
 * mapped here.
 *
 * Validated against the Marketing API v25.0 Ads Action Stats reference. The
 * messaging result (`onsite_conversion.messaging_conversation_started_7d`) and the
 * grouped/omni action types were confirmed via the v25.0 docs.
 * Re-confirm any addition against the v25.0 reference before shipping.
 */

export type ResultKind = "action" | "reach" | "video";

export type ObjectiveResult = {
  /** pt-BR label for the result (e.g. "Compras", "Leads"). */
  labelPt: string;
  /**
   * Ordered `action_type` candidates to read from the `actions` array.
   * First present wins. Empty when the result is not an action (reach).
   */
  actionTypes: string[];
  /** Whether this objective produces a monetary value / ROAS (e.g. sales). */
  hasValue: boolean;
  /** How the result is measured. */
  kind: ResultKind;
};

/**
 * Keyed by the exact `objective` string Meta returns. Includes ODAX and legacy.
 */
export const OBJECTIVE_RESULTS: Record<string, ObjectiveResult> = {
  // ---- ODAX (current) ----
  OUTCOME_TRAFFIC: {
    labelPt: "Cliques no link",
    actionTypes: ["link_click"],
    hasValue: false,
    kind: "action",
  },
  OUTCOME_LEADS: {
    labelPt: "Leads",
    actionTypes: ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped"],
    hasValue: false,
    kind: "action",
  },
  OUTCOME_SALES: {
    labelPt: "Compras",
    actionTypes: [
      "offsite_conversion.fb_pixel_purchase",
      "onsite_conversion.purchase",
      "omni_purchase",
      "purchase",
    ],
    hasValue: true,
    kind: "action",
  },
  OUTCOME_ENGAGEMENT: {
    labelPt: "Engajamento / Conversas",
    actionTypes: [
      "onsite_conversion.messaging_conversation_started_7d",
      "post_engagement",
    ],
    hasValue: false,
    kind: "action",
  },
  OUTCOME_AWARENESS: {
    labelPt: "Alcance",
    actionTypes: [],
    hasValue: false,
    kind: "reach",
  },
  OUTCOME_APP_PROMOTION: {
    labelPt: "Instalações do app",
    actionTypes: ["mobile_app_install", "omni_app_install", "app_install"],
    hasValue: false,
    kind: "action",
  },

  // ---- Legacy (pre-ODAX) — existing campaigns may still use these ----
  LINK_CLICKS: {
    labelPt: "Cliques no link",
    actionTypes: ["link_click"],
    hasValue: false,
    kind: "action",
  },
  POST_ENGAGEMENT: {
    labelPt: "Engajamento da publicação",
    actionTypes: ["post_engagement"],
    hasValue: false,
    kind: "action",
  },
  PAGE_LIKES: {
    labelPt: "Curtidas na Página",
    actionTypes: ["like", "page_engagement"],
    hasValue: false,
    kind: "action",
  },
  LEAD_GENERATION: {
    labelPt: "Leads",
    actionTypes: ["lead", "onsite_conversion.lead_grouped"],
    hasValue: false,
    kind: "action",
  },
  MESSAGES: {
    labelPt: "Conversas iniciadas",
    actionTypes: [
      "onsite_conversion.messaging_conversation_started_7d",
      "onsite_conversion.total_messaging_connection",
    ],
    hasValue: false,
    kind: "action",
  },
  CONVERSIONS: {
    labelPt: "Conversões",
    actionTypes: [
      "offsite_conversion.fb_pixel_purchase",
      "omni_purchase",
      "purchase",
      "offsite_conversion.fb_pixel_lead",
      "lead",
    ],
    hasValue: true,
    kind: "action",
  },
  PRODUCT_CATALOG_SALES: {
    labelPt: "Vendas do catálogo",
    actionTypes: ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"],
    hasValue: true,
    kind: "action",
  },
  APP_INSTALLS: {
    labelPt: "Instalações do app",
    actionTypes: ["mobile_app_install", "app_install", "omni_app_install"],
    hasValue: false,
    kind: "action",
  },
  VIDEO_VIEWS: {
    labelPt: "Reproduções de vídeo",
    actionTypes: ["video_view"],
    hasValue: false,
    kind: "video",
  },
  REACH: {
    labelPt: "Alcance",
    actionTypes: [],
    hasValue: false,
    kind: "reach",
  },
  BRAND_AWARENESS: {
    labelPt: "Reconhecimento da marca",
    actionTypes: [],
    hasValue: false,
    kind: "reach",
  },
  LOCAL_AWARENESS: {
    labelPt: "Alcance local",
    actionTypes: [],
    hasValue: false,
    kind: "reach",
  },
  STORE_VISITS: {
    labelPt: "Visitas à loja",
    actionTypes: ["store_visit"],
    hasValue: false,
    kind: "action",
  },
};

/**
 * Generic fallback for unknown/unmapped objectives: read the most common
 * conversion/result actions in priority order, exposing value when a purchase is
 * found. Keeps the agent useful even on objectives we haven't catalogued yet.
 */
export const DEFAULT_OBJECTIVE_RESULT: ObjectiveResult = {
  labelPt: "Resultado",
  actionTypes: [
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
    "purchase",
    "lead",
    "onsite_conversion.messaging_conversation_started_7d",
    "link_click",
  ],
  hasValue: true,
  kind: "action",
};

/** Resolve the result definition for a campaign objective (case-insensitive). */
export function resolveObjectiveResult(
  objective: string | null | undefined,
): ObjectiveResult {
  if (!objective) return DEFAULT_OBJECTIVE_RESULT;
  return OBJECTIVE_RESULTS[objective.toUpperCase()] ?? DEFAULT_OBJECTIVE_RESULT;
}
