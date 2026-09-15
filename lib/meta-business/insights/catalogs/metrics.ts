/**
 * Metrics whitelist for `getInsights({ extraMetrics })`.
 *
 * `extraMetrics` requested by the agent are validated against this list BEFORE
 * any Meta call — a raw/unknown field never reaches the API (system-prompt rule:
 * hide API mechanics; design §6 catalog). All field names are valid Ads Insights
 * fields in the Marketing API v25.0; re-confirm additions against the v25.0 docs.
 *
 * `isActionArray: true` marks fields that come back as `[{ action_type, value }]`
 * — the normalizer flattens those to a single scalar (sum of values).
 *
 * `actionStat` marks the one exception to "every entry is a Graph field": the
 * messaging metrics are single action types inside `actions` /
 * `cost_per_action_type`, so they are answered from families every read already
 * requests and are never sent in `fields=` (see `graphFieldsFor`).
 */

import {
  MESSAGING_BLOCK_ACTION_TYPE,
  MESSAGING_CONVERSATION_STARTED_ACTION_TYPE,
  MESSAGING_FIRST_REPLY_ACTION_TYPE,
  MESSAGING_SUBSCRIPTION_ACTION_TYPE,
} from "@/lib/meta-business/messaging";

export type MetricGroup =
  | "base"
  | "link"
  | "video"
  | "quality"
  | "conversion"
  | "recall"
  | "messaging";

/**
 * Where a metric that is NOT a Graph field comes from: one `action_type` inside
 * a family every read already requests (`RESULT_FIELDS`). Such a metric never
 * goes in `fields=` — the normalizer reads it off the family.
 */
export type ActionStatSource = {
  family: "actions" | "cost_per_action_type";
  actionType: string;
};

export type MetricSpec = {
  /**
   * Exact Ads Insights field name passed in `fields=` — or, for an
   * `actionStat` metric, the name the agent asks for.
   */
  field: string;
  labelPt: string;
  group: MetricGroup;
  /** Returns an action-typed array → normalizer sums values to a scalar. */
  isActionArray: boolean;
  /** Set for metrics derived from an action family instead of a Graph field. */
  actionStat?: ActionStatSource;
};

/**
 * Default "fast" set returned by every getInsights call. Cheap, universally
 * available scalar fields — no objective/creative dependency.
 */
export const BASE_METRIC_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "frequency",
  "cpc",
  "cpm",
  "ctr",
  "cpp",
] as const;

/**
 * Result/ROAS fields always requested alongside the base set so objective-aware
 * result extraction works (these are flattened by the normalizer, not exposed raw).
 */
export const RESULT_FIELDS = [
  "actions",
  "action_values",
  "cost_per_action_type",
  // Meta names the row's OWN result here (`indicator: "actions:<type>"`), which is the only
  // way to read a result whose action type the objective map does not list — a
  // click-to-WhatsApp ad set under OUTCOME_SALES being the case that forced it. Requested
  // always: it is one field, and `normalize` only consults it when the map matched nothing.
  "cost_per_result",
  "purchase_roas",
  "website_purchase_roas",
] as const;

/** The curated `extraMetrics` whitelist (~35 fields). */
export const EXTRA_METRICS: MetricSpec[] = [
  // ---- link / click engagement ----
  { field: "inline_link_clicks", labelPt: "Cliques no link (inline)", group: "link", isActionArray: false },
  { field: "inline_link_click_ctr", labelPt: "CTR do link (inline)", group: "link", isActionArray: false },
  { field: "cost_per_inline_link_click", labelPt: "Custo por clique no link", group: "link", isActionArray: false },
  { field: "unique_clicks", labelPt: "Cliques únicos", group: "link", isActionArray: false },
  { field: "unique_ctr", labelPt: "CTR único", group: "link", isActionArray: false },
  { field: "unique_link_clicks_ctr", labelPt: "CTR de cliques no link (único)", group: "link", isActionArray: false },
  { field: "cost_per_unique_click", labelPt: "Custo por clique único", group: "link", isActionArray: false },
  { field: "outbound_clicks", labelPt: "Cliques de saída", group: "link", isActionArray: true },
  { field: "outbound_clicks_ctr", labelPt: "CTR de saída", group: "link", isActionArray: true },
  { field: "cost_per_outbound_click", labelPt: "Custo por clique de saída", group: "link", isActionArray: true },

  // ---- video ----
  { field: "video_play_actions", labelPt: "Reproduções de vídeo", group: "video", isActionArray: true },
  { field: "video_thruplay_watched_actions", labelPt: "ThruPlays", group: "video", isActionArray: true },
  { field: "video_avg_time_watched_actions", labelPt: "Tempo médio assistido", group: "video", isActionArray: true },
  { field: "video_p25_watched_actions", labelPt: "Vídeo assistido 25%", group: "video", isActionArray: true },
  { field: "video_p50_watched_actions", labelPt: "Vídeo assistido 50%", group: "video", isActionArray: true },
  { field: "video_p75_watched_actions", labelPt: "Vídeo assistido 75%", group: "video", isActionArray: true },
  { field: "video_p95_watched_actions", labelPt: "Vídeo assistido 95%", group: "video", isActionArray: true },
  { field: "video_p100_watched_actions", labelPt: "Vídeo assistido 100%", group: "video", isActionArray: true },
  { field: "video_30_sec_watched_actions", labelPt: "Vídeo assistido 30s", group: "video", isActionArray: true },
  { field: "cost_per_thruplay", labelPt: "Custo por ThruPlay", group: "video", isActionArray: true },

  // ---- quality rankings ----
  { field: "quality_ranking", labelPt: "Classificação de qualidade", group: "quality", isActionArray: false },
  { field: "engagement_rate_ranking", labelPt: "Classificação de engajamento", group: "quality", isActionArray: false },
  { field: "conversion_rate_ranking", labelPt: "Classificação de conversão", group: "quality", isActionArray: false },

  // ---- conversion / value ----
  { field: "conversions", labelPt: "Conversões", group: "conversion", isActionArray: true },
  { field: "conversion_values", labelPt: "Valor das conversões", group: "conversion", isActionArray: true },
  { field: "cost_per_conversion", labelPt: "Custo por conversão", group: "conversion", isActionArray: true },
  { field: "cost_per_result", labelPt: "Custo por resultado", group: "conversion", isActionArray: true },

  // ---- ad recall (awareness) ----
  { field: "estimated_ad_recall_rate", labelPt: "Taxa estimada de recall", group: "recall", isActionArray: false },
  { field: "estimated_ad_recall_rate_lower_bound", labelPt: "Recall estimado (mín.)", group: "recall", isActionArray: false },
  { field: "estimated_ad_recall_rate_upper_bound", labelPt: "Recall estimado (máx.)", group: "recall", isActionArray: false },

  // ---- messaging (WhatsApp / Messenger / Instagram Direct) ----
  // Not Graph fields: each is one action type the v25.0 Ads Action Stats reference
  // documents, read off `actions` / `cost_per_action_type` (always requested).
  { field: "messaging_conversations_started", labelPt: "Conversas iniciadas", group: "messaging", isActionArray: false, actionStat: { family: "actions", actionType: MESSAGING_CONVERSATION_STARTED_ACTION_TYPE } },
  { field: "cost_per_messaging_conversation_started", labelPt: "Custo por conversa iniciada", group: "messaging", isActionArray: false, actionStat: { family: "cost_per_action_type", actionType: MESSAGING_CONVERSATION_STARTED_ACTION_TYPE } },
  { field: "messaging_new_contacts", labelPt: "Novos contatos por mensagem", group: "messaging", isActionArray: false, actionStat: { family: "actions", actionType: MESSAGING_FIRST_REPLY_ACTION_TYPE } },
  { field: "cost_per_messaging_new_contact", labelPt: "Custo por novo contato", group: "messaging", isActionArray: false, actionStat: { family: "cost_per_action_type", actionType: MESSAGING_FIRST_REPLY_ACTION_TYPE } },
  { field: "messaging_blocked", labelPt: "Conversas bloqueadas", group: "messaging", isActionArray: false, actionStat: { family: "actions", actionType: MESSAGING_BLOCK_ACTION_TYPE } },
  { field: "messaging_subscriptions", labelPt: "Inscrições por mensagem", group: "messaging", isActionArray: false, actionStat: { family: "actions", actionType: MESSAGING_SUBSCRIPTION_ACTION_TYPE } },
];

/** The messaging metric names, spelled out for the agent (they are not guessable Graph fields). */
export const MESSAGING_METRIC_FIELDS: string[] = EXTRA_METRICS.filter(
  (m) => m.group === "messaging",
).map((m) => m.field);

/** Set of allowed extra-metric field names, for O(1) validation. */
export const EXTRA_METRIC_FIELDS: Set<string> = new Set(
  EXTRA_METRICS.map((m) => m.field),
);

const EXTRA_METRIC_BY_FIELD: Map<string, MetricSpec> = new Map(
  EXTRA_METRICS.map((m) => [m.field, m]),
);

export function getMetricSpec(field: string): MetricSpec | undefined {
  return EXTRA_METRIC_BY_FIELD.get(field);
}

/**
 * The subset of validated extra metrics that are real Graph fields — what goes
 * in `fields=`. An `actionStat` metric is served by a family already requested,
 * and sending its name would make Graph refuse the whole call.
 */
export function graphFieldsFor(fields: string[]): string[] {
  return fields.filter((field) => !EXTRA_METRIC_BY_FIELD.get(field)?.actionStat);
}

/**
 * Split requested extra metrics into accepted vs rejected (off-whitelist).
 * Rejected fields are dropped before the Meta call; the tool reports them so the
 * agent can tell the user a metric isn't available.
 */
export function validateExtraMetrics(requested: string[] | undefined): {
  valid: string[];
  rejected: string[];
} {
  if (!requested?.length) return { valid: [], rejected: [] };
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const field of requested) {
    if (EXTRA_METRIC_FIELDS.has(field)) valid.push(field);
    else rejected.push(field);
  }
  return { valid, rejected };
}
