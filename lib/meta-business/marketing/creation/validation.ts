/**
 * Local, fail-fast validation for the Meta creation primitives (ADR 0009).
 *
 * Pure functions, ZERO Meta calls — they encode the known v25.0 rules so a bad
 * config is rejected before it ever reaches Meta (protecting the app's API
 * error-rate / standing). Each returns a list of {@link CreateIssue} so callers
 * can COLLECT ALL violations in one pass. Rules whose authority is the live
 * `/validation/` matrix (JS-rendered, not extractable) are encoded from the
 * official SDK value-sets + documented groupings and are deliberately GENEROUS to
 * avoid false local rejections — Meta `validate_only` is the final backstop.
 *
 * Sources: scratchpad/v25-verified-rules.md (live docs + facebook-python-business-sdk).
 */

import { type CreateIssue, type CreateLevel, localIssue } from "./types";

// ───────────────────────── enums / tables ─────────────────────────

/** The only objectives creatable on a NEW campaign in v25.0 (verbatim API error). */
export const CREATABLE_OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_APP_PROMOTION",
] as const;
export type CreatableObjective = (typeof CREATABLE_OBJECTIVES)[number];

/** objective → allowed optimization_goal (generous; matrix is validate_only-backstopped). */
const OBJECTIVE_OPTIMIZATION: Record<CreatableObjective, string[]> = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"],
  OUTCOME_TRAFFIC: [
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "REACH",
    "VISIT_INSTAGRAM_PROFILE",
    "QUALITY_CALL",
  ],
  OUTCOME_ENGAGEMENT: [
    "POST_ENGAGEMENT",
    "PAGE_LIKES",
    "EVENT_RESPONSES",
    "THRUPLAY",
    "CONVERSATIONS",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "REACH",
    "LINK_CLICKS",
  ],
  OUTCOME_LEADS: [
    "LEAD_GENERATION",
    "QUALITY_LEAD",
    "OFFSITE_CONVERSIONS",
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "REACH",
    "CONVERSATIONS",
    "QUALITY_CALL",
  ],
  OUTCOME_APP_PROMOTION: [
    "APP_INSTALLS",
    "APP_INSTALLS_AND_OFFSITE_CONVERSIONS",
    "OFFSITE_CONVERSIONS",
    "IN_APP_VALUE",
    "LINK_CLICKS",
    "VALUE",
  ],
  OUTCOME_SALES: [
    "OFFSITE_CONVERSIONS",
    "VALUE",
    "CONVERSATIONS",
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "REACH",
  ],
};

/** Recommended default optimization_goal per objective. */
export const DEFAULT_OPTIMIZATION: Record<CreatableObjective, string> = {
  OUTCOME_AWARENESS: "REACH",
  OUTCOME_TRAFFIC: "LINK_CLICKS",
  OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
  OUTCOME_LEADS: "LEAD_GENERATION",
  OUTCOME_APP_PROMOTION: "APP_INSTALLS",
  OUTCOME_SALES: "OFFSITE_CONVERSIONS",
};

/**
 * optimization_goal → allowed billing_event. IMPRESSIONS is valid for every goal
 * (universal fallback), so it is always implicitly allowed.
 */
const OPTIMIZATION_BILLING: Record<string, string[]> = {
  LINK_CLICKS: ["LINK_CLICKS"],
  POST_ENGAGEMENT: ["POST_ENGAGEMENT"],
  PAGE_LIKES: ["PAGE_LIKES"],
  THRUPLAY: ["THRUPLAY"],
  APP_INSTALLS: ["APP_INSTALLS", "LINK_CLICKS"],
  EVENT_RESPONSES: ["POST_ENGAGEMENT"],
};

/** objective → allowed destination_type (checked only when provided; generous). */
const OBJECTIVE_DESTINATION: Record<CreatableObjective, string[]> = {
  OUTCOME_AWARENESS: ["UNDEFINED", "WEBSITE"],
  OUTCOME_TRAFFIC: [
    "WEBSITE",
    "APP",
    "MESSENGER",
    "WHATSAPP",
    "INSTAGRAM_PROFILE",
    "PHONE_CALL",
    "UNDEFINED",
  ],
  OUTCOME_ENGAGEMENT: [
    "ON_POST",
    "ON_VIDEO",
    "ON_PAGE",
    "ON_EVENT",
    "WEBSITE",
    "APP",
    "MESSENGER",
    "WHATSAPP",
    "INSTAGRAM_DIRECT",
    "PHONE_CALL",
  ],
  OUTCOME_LEADS: [
    "ON_AD",
    "WEBSITE",
    "APP",
    "MESSENGER",
    "INSTAGRAM_DIRECT",
    "PHONE_CALL",
  ],
  OUTCOME_APP_PROMOTION: ["APP", "APPLINKS_AUTOMATIC", "UNDEFINED"],
  OUTCOME_SALES: [
    "WEBSITE",
    "APP",
    "MESSENGER",
    "WHATSAPP",
    "SHOP_AUTOMATIC",
    "PHONE_CALL",
  ],
};
/** Messaging combo destinations accepted across messaging-capable objectives. */
const MESSAGING_DESTINATIONS = new Set([
  "MESSAGING_MESSENGER_WHATSAPP",
  "MESSAGING_INSTAGRAM_DIRECT_MESSENGER",
  "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP",
  "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP",
]);

export const SPECIAL_AD_CATEGORIES = [
  "NONE",
  "CREDIT",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "HOUSING",
  "ISSUES_ELECTIONS_POLITICS",
  "ONLINE_GAMBLING_AND_GAMING",
] as const;
/** Categories that impose the restricted targeting regime. */
const RESTRICTED_CATEGORIES = new Set([
  "CREDIT",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "HOUSING",
]);

export const BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
] as const;
export type BidStrategy = (typeof BID_STRATEGIES)[number];

export const CUSTOM_EVENT_TYPES = new Set([
  "ACHIEVEMENT_UNLOCKED", "ADD_PAYMENT_INFO", "ADD_TO_CART", "ADD_TO_WISHLIST",
  "AD_IMPRESSION", "COMPLETE_REGISTRATION", "CONTACT", "CONTENT_VIEW",
  "CUSTOMIZE_PRODUCT", "D2_RETENTION", "D7_RETENTION", "DONATE", "FIND_LOCATION",
  "INITIATED_CHECKOUT", "LEAD", "LEVEL_ACHIEVED", "LISTING_INTERACTION",
  "MESSAGING_CONVERSATION_STARTED_7D", "OTHER", "PURCHASE", "RATE", "SCHEDULE",
  "SEARCH", "SERVICE_BOOKING_REQUEST", "SPENT_CREDITS", "START_TRIAL",
  "SUBMIT_APPLICATION", "SUBSCRIBE", "TUTORIAL_COMPLETION",
]);

const INSTAGRAM_POSITIONS = new Set([
  "stream", "story", "explore", "explore_home", "reels", "profile_feed",
  "ig_search", "profile_reels",
]);
const FACEBOOK_POSITIONS = new Set([
  "feed", "right_hand_column", "marketplace", "video_feeds", "story", "search",
  "instream_video", "facebook_reels", "facebook_reels_overlay", "profile_feed",
  "notification",
]);
const PUBLISHER_PLATFORMS = new Set([
  "facebook", "instagram", "threads", "messenger", "audience_network",
]);

/** Carousel card bounds: doc says 2–5, real limit is 10 (ADR 0009 / verified rules). */
export const CAROUSEL_MIN_CARDS = 2;
export const CAROUSEL_MAX_CARDS = 10;

// ───────────────────── subcode → suggestion overrides ─────────────────────

/**
 * AI-actionable overrides for specific Meta subcodes, layered on top of the
 * generic `errorMap` suggestion already carried by GraphApiError. Reuses the
 * duplication self-repair knowledge (ADR 0003/0004) + the v25.0 rules.
 */
export function subcodeSuggestion(
  code?: number,
  subcode?: number,
): string | undefined {
  const map: Record<string, string> = {
    "4834011":
      "Conjunto ABO: envie is_adset_budget_sharing_enabled como \"True\" ou \"False\" na criação da campanha.",
    "4834002":
      "Defina orçamento na campanha (CBO) OU nos conjuntos (ABO), nunca nos dois. Remova um dos lados.",
    "2909035":
      "Categoria especial: use faixa etária 18–65, remova segmentação por gênero, amplie o raio (≥25 km) e remova CEPs.",
    "2446383":
      "Objetivo de vendas exige URL externa: adicione um call_to_action com value.link (URL https) no criativo.",
    "2061015":
      "Objetivo de vendas exige URL externa: adicione a URL de destino (https) no criativo.",
    "100_3858258":
      "Suba a imagem via /adimages e use image_hash em vez de uma URL em picture (a Meta não conseguiu baixar a imagem).",
    "1487007":
      "A campanha/conjunto já encerrou; crie uma nova em vez de editar, ou defina um end_time futuro.",
    "3858750":
      "O conjunto já encerrou (flight expirado): defina um end_time futuro no conjunto antes de editar segmentação/criativo, ou crie um novo conjunto.",
    "2238055":
      "Não envie instagram_user_id e instagram_actor_id juntos; e garanta orçamento de campanha ≥ mínimo dos conjuntos.",
  };
  // Meta returns these as either a bare `code` or `code` + `error_subcode`, and
  // some map entries are keyed by subcode alone (e.g. "1487007") while others are
  // `code_subcode` (e.g. "100_3858258"). Try the most specific key first, then
  // the subcode alone, then the code alone.
  if (subcode != null && map[`${code}_${subcode}`]) return map[`${code}_${subcode}`];
  if (subcode != null && map[String(subcode)]) return map[String(subcode)];
  if (code != null && map[String(code)]) return map[String(code)];
  return undefined;
}

// ───────────────────────── validators ─────────────────────────

export function validateObjective(objective: string): CreateIssue[] {
  if (!CREATABLE_OBJECTIVES.includes(objective as CreatableObjective)) {
    return [
      localIssue(
        "campaign",
        "OBJECTIVE_NOT_CREATABLE",
        `Objetivo "${objective}" não pode ser usado para criar campanha na v25.0.`,
        `Use um dos objetivos ODAX: ${CREATABLE_OBJECTIVES.join(", ")}.`,
        ["objective"],
      ),
    ];
  }
  return [];
}

export function validateOptimizationForObjective(
  objective: string,
  optimizationGoal: string,
): CreateIssue[] {
  const allowed = OBJECTIVE_OPTIMIZATION[objective as CreatableObjective];
  if (!allowed) return []; // unknown objective already flagged by validateObjective
  if (!allowed.includes(optimizationGoal)) {
    return [
      localIssue(
        "adset",
        "OPTIMIZATION_INVALID_FOR_OBJECTIVE",
        `optimization_goal "${optimizationGoal}" não é válido para o objetivo "${objective}".`,
        `Para "${objective}", use um de: ${allowed.join(", ")} (padrão ${DEFAULT_OPTIMIZATION[objective as CreatableObjective]}).`,
        ["optimization_goal"],
      ),
    ];
  }
  return [];
}

export function validateBillingForOptimization(
  optimizationGoal: string,
  billingEvent: string,
): CreateIssue[] {
  if (billingEvent === "IMPRESSIONS") return []; // universal
  const allowed = OPTIMIZATION_BILLING[optimizationGoal];
  if (!allowed) return []; // generous: unknown goal → let validate_only decide
  if (!allowed.includes(billingEvent)) {
    return [
      localIssue(
        "adset",
        "BILLING_INVALID_FOR_OPTIMIZATION",
        `billing_event "${billingEvent}" não é válido para optimization_goal "${optimizationGoal}".`,
        `Use IMPRESSIONS (sempre aceito) ou um de: ${allowed.join(", ")}.`,
        ["billing_event"],
      ),
    ];
  }
  return [];
}

export function validateDestinationForObjective(
  objective: string,
  destinationType?: string,
): CreateIssue[] {
  if (!destinationType) return [];
  if (MESSAGING_DESTINATIONS.has(destinationType)) return [];
  const allowed = OBJECTIVE_DESTINATION[objective as CreatableObjective];
  if (!allowed) return [];
  if (!allowed.includes(destinationType)) {
    return [
      localIssue(
        "adset",
        "DESTINATION_INVALID_FOR_OBJECTIVE",
        `destination_type "${destinationType}" não é válido para o objetivo "${objective}".`,
        `Para "${objective}", use um de: ${allowed.join(", ")}.`,
        ["destination_type"],
      ),
    ];
  }
  return [];
}

export function validateSpecialAdCategories(
  categories: string[] | undefined,
): CreateIssue[] {
  if (!categories) return [];
  const invalid = categories.filter(
    (c) => !SPECIAL_AD_CATEGORIES.includes(c as (typeof SPECIAL_AD_CATEGORIES)[number]),
  );
  if (invalid.length) {
    return [
      localIssue(
        "campaign",
        "SPECIAL_CATEGORY_INVALID",
        `Categoria especial inválida: ${invalid.join(", ")}.`,
        `Use um de: ${SPECIAL_AD_CATEGORIES.join(", ")} (ou [] / ["NONE"] quando não houver categoria).`,
        ["special_ad_categories"],
      ),
    ];
  }
  return [];
}

export function validateCampaignBudget(input: {
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  hasStopTime?: boolean;
  isAdsetBudgetSharingEnabledProvided?: boolean;
}): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const hasDaily = (input.dailyBudgetCents ?? 0) > 0;
  const hasLifetime = (input.lifetimeBudgetCents ?? 0) > 0;

  if (hasDaily && hasLifetime) {
    issues.push(
      localIssue(
        "campaign",
        "BUDGET_DAILY_XOR_LIFETIME",
        "Defina daily_budget OU lifetime_budget na campanha, nunca os dois.",
        "Escolha apenas um tipo de orçamento de campanha.",
        ["daily_budget", "lifetime_budget"],
      ),
    );
  }

  const isCbo = hasDaily || hasLifetime;

  if (isCbo && input.isAdsetBudgetSharingEnabledProvided) {
    issues.push(
      localIssue(
        "campaign",
        "BUDGET_SHARING_WITH_CBO",
        "is_adset_budget_sharing_enabled não deve ser enviado com orçamento de campanha (CBO).",
        "Remova is_adset_budget_sharing_enabled, ou remova o orçamento da campanha para usar ABO.",
        ["is_adset_budget_sharing_enabled"],
      ),
    );
  }

  if (!isCbo && !input.isAdsetBudgetSharingEnabledProvided) {
    issues.push(
      localIssue(
        "campaign",
        "ABO_FLAG_REQUIRED",
        'Campanha ABO (sem orçamento na campanha) exige is_adset_budget_sharing_enabled "True"/"False" (v24.0+).',
        'Envie is_adset_budget_sharing_enabled como "True" ou "False" ao criar a campanha.',
        ["is_adset_budget_sharing_enabled"],
      ),
    );
  }

  if (hasLifetime && !input.hasStopTime) {
    issues.push(
      localIssue(
        "campaign",
        "LIFETIME_REQUIRES_STOP_TIME",
        "Orçamento total (lifetime) da campanha exige stop_time.",
        "Defina stop_time (data/hora de término) ao usar lifetime_budget.",
        ["stop_time"],
      ),
    );
  }

  return issues;
}

export function validateAdSetBudget(input: {
  parentUsesCampaignBudget: boolean;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  hasEndTime?: boolean;
}): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const hasDaily = (input.dailyBudgetCents ?? 0) > 0;
  const hasLifetime = (input.lifetimeBudgetCents ?? 0) > 0;

  if (input.parentUsesCampaignBudget) {
    if (hasDaily || hasLifetime) {
      issues.push(
        localIssue(
          "adset",
          "ADSET_BUDGET_WITH_CBO",
          "A campanha usa orçamento (CBO); o conjunto não pode ter orçamento próprio.",
          "Remova daily_budget/lifetime_budget do conjunto, ou crie a campanha sem orçamento (ABO).",
          ["daily_budget", "lifetime_budget"],
        ),
      );
    }
    return issues;
  }

  // ABO: ad set must carry exactly one budget.
  if (hasDaily && hasLifetime) {
    issues.push(
      localIssue(
        "adset",
        "BUDGET_DAILY_XOR_LIFETIME",
        "Defina daily_budget OU lifetime_budget no conjunto, nunca os dois.",
        "Escolha apenas um tipo de orçamento.",
        ["daily_budget", "lifetime_budget"],
      ),
    );
  } else if (!hasDaily && !hasLifetime) {
    issues.push(
      localIssue(
        "adset",
        "ADSET_BUDGET_REQUIRED",
        "Campanha ABO exige orçamento em cada conjunto.",
        "Defina daily_budget ou lifetime_budget (em centavos) no conjunto.",
        ["daily_budget"],
      ),
    );
  }

  if (hasLifetime && !input.hasEndTime) {
    issues.push(
      localIssue(
        "adset",
        "LIFETIME_REQUIRES_END_TIME",
        "Orçamento total (lifetime) do conjunto exige end_time.",
        "Defina end_time (data/hora de término) ao usar lifetime_budget.",
        ["end_time"],
      ),
    );
  }

  return issues;
}

export function validateBid(input: {
  strategy?: string;
  bidAmountCents?: number;
  roasFloor?: number;
  optimizationGoal?: string;
}): CreateIssue[] {
  const { strategy, bidAmountCents, roasFloor, optimizationGoal } = input;
  if (!strategy) return [];

  if (!BID_STRATEGIES.includes(strategy as BidStrategy)) {
    return [
      localIssue(
        "adset",
        "BID_STRATEGY_INVALID",
        `bid_strategy "${strategy}" inválido.`,
        `Use um de: ${BID_STRATEGIES.join(", ")}.`,
        ["bid_strategy"],
      ),
    ];
  }

  const issues: CreateIssue[] = [];
  const hasBid = (bidAmountCents ?? 0) > 0;
  const needsBid =
    strategy === "LOWEST_COST_WITH_BID_CAP" || strategy === "COST_CAP";

  if (needsBid && !hasBid) {
    issues.push(
      localIssue(
        "adset",
        "BID_AMOUNT_REQUIRED",
        `A estratégia ${strategy} exige bid_amount (o teto/alvo em centavos).`,
        "Informe bid_amount em centavos (> 0).",
        ["bid_amount"],
      ),
    );
  }

  if (strategy === "LOWEST_COST_WITHOUT_CAP" && hasBid) {
    issues.push(
      localIssue(
        "adset",
        "BID_AMOUNT_FORBIDDEN",
        "LOWEST_COST_WITHOUT_CAP não aceita bid_amount.",
        "Remova bid_amount ou troque para COST_CAP / LOWEST_COST_WITH_BID_CAP.",
        ["bid_amount"],
      ),
    );
  }

  if (strategy === "LOWEST_COST_WITH_MIN_ROAS") {
    if (hasBid) {
      issues.push(
        localIssue(
          "adset",
          "BID_AMOUNT_FORBIDDEN",
          "LOWEST_COST_WITH_MIN_ROAS não aceita bid_amount (o piso vai em roas_average_floor).",
          "Remova bid_amount e informe roasFloor.",
          ["bid_amount"],
        ),
      );
    }
    if (roasFloor == null) {
      issues.push(
        localIssue(
          "adset",
          "ROAS_FLOOR_REQUIRED",
          "LOWEST_COST_WITH_MIN_ROAS exige um piso de ROAS.",
          "Informe roasFloor (ex.: 2.0 = ROAS 2×); será escalado ×10000 (bid_constraints.roas_average_floor).",
          ["bid_constraints"],
        ),
      );
    } else if (roasFloor < 0.01 || roasFloor > 1000) {
      issues.push(
        localIssue(
          "adset",
          "ROAS_FLOOR_OUT_OF_RANGE",
          `roasFloor ${roasFloor} fora da faixa permitida (0.01–1000).`,
          "Use um ROAS entre 0.01 e 1000.",
          ["bid_constraints"],
        ),
      );
    }
    if (optimizationGoal && optimizationGoal !== "VALUE") {
      issues.push(
        localIssue(
          "adset",
          "ROAS_REQUIRES_VALUE",
          "ROAS mínimo só funciona com optimization_goal=VALUE.",
          "Use optimization_goal=VALUE (otimização por valor) com a estratégia de ROAS mínimo.",
          ["optimization_goal"],
        ),
      );
    }
  }

  return issues;
}

export function validateDayparting(input: {
  hasEffectiveLifetimeBudget: boolean;
  mode: "continuous" | "dayparting";
  blocks?: Array<{ days: number[]; startMinute: number; endMinute: number }>;
}): CreateIssue[] {
  if (input.mode !== "dayparting") return [];
  const issues: CreateIssue[] = [];

  if (!input.hasEffectiveLifetimeBudget) {
    issues.push(
      localIssue(
        "adset",
        "DAYPARTING_REQUIRES_LIFETIME",
        "Agendamento por horários (dayparting) exige orçamento vitalício (no conjunto ABO ou na campanha CBO).",
        "Troque para orçamento total (lifetime) ou use veiculação contínua.",
        ["adset_schedule"],
      ),
    );
  }

  if (!input.blocks || input.blocks.length === 0) {
    issues.push(
      localIssue(
        "adset",
        "DAYPARTING_BLOCKS_REQUIRED",
        "Dayparting precisa de pelo menos um bloco de horário.",
        "Inclua blocos com days (0=dom…6=sáb), startMinute e endMinute.",
        ["adset_schedule"],
      ),
    );
    return issues;
  }

  input.blocks.forEach((b, i) => {
    if (!b.days?.length || b.days.some((d) => d < 0 || d > 6)) {
      issues.push(
        localIssue(
          "adset",
          "DAYPARTING_DAYS_INVALID",
          `Bloco ${i}: days deve conter inteiros de 0 (domingo) a 6 (sábado).`,
          "Use days no intervalo 0–6.",
          ["adset_schedule", String(i), "days"],
        ),
      );
    }
    if (b.startMinute % 60 !== 0 || b.endMinute % 60 !== 0) {
      issues.push(
        localIssue(
          "adset",
          "DAYPARTING_NOT_HOUR_ALIGNED",
          `Bloco ${i}: start_minute/end_minute devem cair na hora cheia (múltiplos de 60).`,
          "Arredonde os minutos para a hora cheia (ex.: 540 = 9h, 1080 = 18h).",
          ["adset_schedule", String(i)],
        ),
      );
    }
    if (b.endMinute - b.startMinute < 60) {
      issues.push(
        localIssue(
          "adset",
          "DAYPARTING_BLOCK_TOO_SHORT",
          `Bloco ${i}: o intervalo deve ter pelo menos 1 hora.`,
          "Garanta endMinute − startMinute ≥ 60.",
          ["adset_schedule", String(i)],
        ),
      );
    }
  });

  return issues;
}

export function validateSpecialCategoryTargeting(input: {
  categories?: string[];
  country?: string[];
  genders?: number[];
  ageMin?: number;
  ageMax?: number;
  hasZips?: boolean;
}): CreateIssue[] {
  const cats = (input.categories ?? []).filter((c) => c && c !== "NONE");
  if (cats.length === 0) return [];

  const issues: CreateIssue[] = [];

  if (!input.country || input.country.length === 0) {
    issues.push(
      localIssue(
        "campaign",
        "SPECIAL_CATEGORY_COUNTRY_REQUIRED",
        "Categoria especial exige special_ad_category_country.",
        "Inclua o(s) país(es) ISO-2 da categoria especial (ex.: [\"BR\"]).",
        ["special_ad_category_country"],
      ),
    );
  }

  const restricted = cats.some((c) => RESTRICTED_CATEGORIES.has(c));
  if (!restricted) return issues;

  if (input.genders && input.genders.length > 0) {
    issues.push(
      localIssue(
        "adset",
        "SPECIAL_CATEGORY_NO_GENDER",
        "Categoria especial restrita não permite segmentação por gênero.",
        "Remova genders (a entrega vai para todos os gêneros).",
        ["targeting", "genders"],
      ),
    );
  }
  if ((input.ageMin != null && input.ageMin < 18) || (input.ageMax != null && input.ageMax > 65)) {
    issues.push(
      localIssue(
        "adset",
        "SPECIAL_CATEGORY_AGE_18_65",
        "Categoria especial restrita força a faixa etária 18–65.",
        "Defina age_min=18 e age_max=65.",
        ["targeting", "age_min"],
      ),
    );
  }
  if (input.hasZips) {
    issues.push(
      localIssue(
        "adset",
        "SPECIAL_CATEGORY_NO_ZIPS",
        "Categoria especial restrita não permite segmentação por CEP.",
        "Remova zips do geo_locations; use cidades/raio (≥25 km).",
        ["targeting", "geo_locations", "zips"],
      ),
    );
  }

  return issues;
}

/**
 * Advantage+ Audience age-cap rule (Meta error code 100 / subcode 1870189),
 * CONFIRMED live via `validate_only` against real ad sets on 2026-06-27:
 *
 *   "Com conjuntos de anúncios que usam o público Advantage+, o controle de
 *    idade máxima do público não pode ser definido como menos de 65 anos."
 *
 * When `advantage_audience` is ON, the maximum age is only a *suggestion* — Meta
 * forbids capping `age_max` below 65 and rejects EVERY such request (verified to
 * fail regardless of `targeting_relaxation_types` or audiences). We reject it
 * locally with Meta's own wording so a doomed write never reaches their servers.
 */
export function validateAdvantageAudienceAgeMax(input: {
  advantageAudience?: boolean | number;
  ageMax?: number;
}): CreateIssue[] {
  const advantageOn =
    input.advantageAudience === true || input.advantageAudience === 1;
  if (!advantageOn) return [];
  if (input.ageMax != null && input.ageMax < 65) {
    return [
      localIssue(
        "adset",
        "ADVANTAGE_AUDIENCE_AGE_MAX_65",
        "Com público Advantage+ ligado, a idade máxima não pode ser menor que 65 (a Meta a trata só como sugestão, nunca como limite rígido).",
        "Defina age_max=65 (ou remova o limite máximo) mantendo o Advantage+. Para usar a idade máxima como limite rígido, desligue o Advantage+ (advantage_audience=0).",
        ["targeting", "age_max"],
      ),
    ];
  }
  return [];
}

/** Geo keys that count as "targeting at least one place" (v25.0 geo_locations). */
const GEO_TARGETABLE_KEYS = [
  "countries",
  "country_groups",
  "regions",
  "cities",
  "zips",
  "geo_markets",
  "electoral_districts",
  "places",
  "custom_locations",
  "location_cluster_ids",
] as const;

/**
 * An ad set must target at least one location — Meta rejects an empty
 * `geo_locations`. This recognizes ALL documented geo keys (incl. radius-based
 * `custom_locations` and `geo_markets`/`places`/`zips`), so a legitimately
 * targeted ad set is never flagged as "missing geo". Validate against the
 * EFFECTIVE geo (current merged with the requested change) on update.
 */
export function validateGeoLocationsPresent(
  geoLocations: Record<string, unknown> | null | undefined,
): CreateIssue[] {
  const hasAny =
    !!geoLocations &&
    GEO_TARGETABLE_KEYS.some((key) => {
      const value = (geoLocations as Record<string, unknown>)[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
  if (hasAny) return [];
  return [
    localIssue(
      "adset",
      "GEO_LOCATIONS_REQUIRED",
      "O conjunto precisa segmentar ao menos uma localização (geo_locations vazio).",
      "Inclua ao menos uma localização: países, regiões, cidades, CEPs, mercados, distritos, locais (places) ou pontos com raio (custom_locations).",
      ["targeting", "geo_locations"],
    ),
  ];
}

export function validatePlacements(input: {
  instagramOnly?: boolean;
  publisherPlatforms?: string[];
  facebookPositions?: string[];
  instagramPositions?: string[];
}): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const { publisherPlatforms, facebookPositions, instagramPositions } = input;

  if (publisherPlatforms && publisherPlatforms.length) {
    const invalid = publisherPlatforms.filter((p) => !PUBLISHER_PLATFORMS.has(p));
    if (invalid.length) {
      issues.push(
        localIssue(
          "adset",
          "PUBLISHER_PLATFORM_INVALID",
          `publisher_platforms inválido: ${invalid.join(", ")}.`,
          `Use um de: ${[...PUBLISHER_PLATFORMS].join(", ")}.`,
          ["targeting", "publisher_platforms"],
        ),
      );
    }
    if (
      publisherPlatforms.length === 1 &&
      publisherPlatforms[0] === "audience_network"
    ) {
      issues.push(
        localIssue(
          "adset",
          "AUDIENCE_NETWORK_NOT_ALONE",
          "audience_network não pode ser o único posicionamento.",
          "Inclua facebook e/ou instagram junto, ou use posicionamentos automáticos.",
          ["targeting", "publisher_platforms"],
        ),
      );
    }
    if (input.instagramOnly && publisherPlatforms.some((p) => p !== "instagram")) {
      issues.push(
        localIssue(
          "adset",
          "INSTAGRAM_ONLY_PLACEMENTS",
          "Este fluxo (tráfego para perfil do Instagram) aceita apenas posicionamentos do Instagram.",
          "Use somente publisher_platforms=[\"instagram\"] e instagram_positions.",
          ["targeting", "publisher_platforms"],
        ),
      );
    }
  }

  if (facebookPositions?.length) {
    const invalid = facebookPositions.filter((p) => !FACEBOOK_POSITIONS.has(p));
    if (invalid.length) {
      issues.push(
        localIssue(
          "adset",
          "FACEBOOK_POSITION_INVALID",
          `facebook_positions inválido: ${invalid.join(", ")}.`,
          `Use posicionamentos válidos do Facebook (ex.: feed, story, facebook_reels).`,
          ["targeting", "facebook_positions"],
        ),
      );
    }
  }

  if (instagramPositions?.length) {
    const invalid = instagramPositions.filter((p) => !INSTAGRAM_POSITIONS.has(p));
    if (invalid.length) {
      issues.push(
        localIssue(
          "adset",
          "INSTAGRAM_POSITION_INVALID",
          `instagram_positions inválido: ${invalid.join(", ")}.`,
          `Use posicionamentos válidos do Instagram (ex.: stream, story, reels, explore).`,
          ["targeting", "instagram_positions"],
        ),
      );
    }
    if (
      instagramPositions.includes("explore_home") &&
      !instagramPositions.includes("explore")
    ) {
      issues.push(
        localIssue(
          "adset",
          "EXPLORE_HOME_REQUIRES_EXPLORE",
          'O posicionamento "explore_home" do Instagram exige também "explore".',
          'Adicione "explore" a instagram_positions junto de "explore_home".',
          ["targeting", "instagram_positions"],
        ),
      );
    }
  }

  return issues;
}

export function validatePromotedObject(input: {
  optimizationGoal?: string;
  destinationType?: string;
  promotedObject?: Record<string, unknown>;
}): CreateIssue[] {
  const goal = input.optimizationGoal;
  const po = input.promotedObject ?? {};
  const issues: CreateIssue[] = [];

  const needsPixel = goal === "OFFSITE_CONVERSIONS" || goal === "VALUE";
  if (needsPixel) {
    if (!po["pixel_id"]) {
      issues.push(
        localIssue(
          "adset",
          "PROMOTED_OBJECT_PIXEL_REQUIRED",
          `optimization_goal ${goal} exige promoted_object com pixel_id.`,
          "Defina promoted_object.pixel_id (e custom_event_type, ex.: PURCHASE).",
          ["promoted_object", "pixel_id"],
        ),
      );
    }
    const evt = po["custom_event_type"];
    if (evt != null && !CUSTOM_EVENT_TYPES.has(String(evt))) {
      issues.push(
        localIssue(
          "adset",
          "CUSTOM_EVENT_TYPE_INVALID",
          `custom_event_type "${String(evt)}" inválido.`,
          "Use um evento válido (ex.: PURCHASE, LEAD, INITIATED_CHECKOUT, CONTENT_VIEW). Atenção: é INITIATED_CHECKOUT e CONTENT_VIEW.",
          ["promoted_object", "custom_event_type"],
        ),
      );
    }
  }

  if (goal === "LEAD_GENERATION" && !po["page_id"]) {
    issues.push(
      localIssue(
        "adset",
        "PROMOTED_OBJECT_PAGE_REQUIRED",
        "Leads por formulário (LEAD_GENERATION) exige promoted_object.page_id.",
        "Defina promoted_object.page_id. O id do formulário vai no criativo (call_to_action.value.lead_gen_form_id), não aqui.",
        ["promoted_object", "page_id"],
      ),
    );
  }

  if (input.destinationType === "APP") {
    if (!po["application_id"] || !po["object_store_url"]) {
      issues.push(
        localIssue(
          "adset",
          "PROMOTED_OBJECT_APP_REQUIRED",
          "Destino de app exige promoted_object com application_id e object_store_url.",
          "Defina promoted_object.application_id e object_store_url.",
          ["promoted_object", "application_id"],
        ),
      );
    }
  }

  return issues;
}

export function validateCarouselCards(cardCount: number): CreateIssue[] {
  if (cardCount < CAROUSEL_MIN_CARDS || cardCount > CAROUSEL_MAX_CARDS) {
    return [
      localIssue(
        "creative",
        "CAROUSEL_CARD_COUNT",
        `Carrossel precisa de ${CAROUSEL_MIN_CARDS}–${CAROUSEL_MAX_CARDS} cartões (recebeu ${cardCount}).`,
        `Use entre ${CAROUSEL_MIN_CARDS} e ${CAROUSEL_MAX_CARDS} cartões (child_attachments).`,
        ["object_story_spec", "link_data", "child_attachments"],
      ),
    ];
  }
  return [];
}

/** Convenience: run several validators and flatten into one collect-all list. */
export function collect(...groups: CreateIssue[][]): CreateIssue[] {
  return groups.flat();
}
