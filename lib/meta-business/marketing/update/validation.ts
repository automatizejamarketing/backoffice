/**
 * Local, fail-fast validation for the Meta UPDATE primitives (ADR 0010).
 *
 * Updates are SPARSE and conditional on the EXISTING object, so these validators
 * run against the EFFECTIVE state (current snapshot merged with the requested
 * change), computed by each primitive. They REUSE the creation rule helpers
 * (validateBid / validateDayparting / validatePlacements / …) wherever the rule
 * is identical on the merged values, and add the update-only rules:
 * - status ∈ {ACTIVE, PAUSED, ARCHIVED} (DELETED → use the delete primitive;
 *   effective_status is never written);
 * - budget XOR / lifetime↔stop_time WITHOUT the creation-only ABO flag rule;
 * - non-fatal review-trigger WARNINGS (creative/targeting/optimization/billing
 *   changes can send an ad back to review — best-practices.md).
 *
 * Pure functions, ZERO Meta calls — Meta `validate_only` is the final backstop.
 */

import {
  type CreateIssue,
  type CreateLevel,
  localIssue,
} from "../creation/types";

export {
  validateBid,
  validateDayparting,
  validatePlacements,
  validatePromotedObject,
  validateSpecialAdCategories,
  validateSpecialCategoryTargeting,
  validateOptimizationForObjective,
  validateBillingForOptimization,
  validateDestinationForObjective,
  validateAdvantageAudienceAgeMax,
  validateGeoLocationsPresent,
  subcodeSuggestion,
  collect,
} from "../creation/validation";

// ───────────────────────── status ─────────────────────────

/** Statuses a write may set. ARCHIVED is allowed; DELETED stays in deleteMetaObject. */
export const UPDATE_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export function validateUpdateStatus(
  level: CreateLevel,
  status: string | undefined,
): CreateIssue[] {
  if (status === undefined) return [];
  if (status === "DELETED") {
    return [
      localIssue(
        level,
        "STATUS_DELETED_USE_DELETE",
        "status=DELETED não é permitido no update (operação destrutiva).",
        "Use a operação de exclusão (deleteAdObject) para apagar; para só parar a veiculação use PAUSED ou ARCHIVED.",
        ["status"],
      ),
    ];
  }
  if (!UPDATE_STATUSES.includes(status as UpdateStatus)) {
    return [
      localIssue(
        level,
        "STATUS_INVALID",
        `status "${status}" inválido para atualização.`,
        `Use um de: ${UPDATE_STATUSES.join(", ")}. effective_status é somente leitura e nunca é enviado.`,
        ["status"],
      ),
    ];
  }
  return [];
}

// ───────────────────────── budget (update-aware) ─────────────────────────

/**
 * Campaign budget XOR + lifetime↔stop_time, on the EFFECTIVE values. Unlike
 * creation, update does NOT require the ABO `is_adset_budget_sharing_enabled`
 * flag (the mode is already established on the live object).
 */
export function validateCampaignBudgetUpdate(input: {
  effectiveDailyCents?: number;
  effectiveLifetimeCents?: number;
  effectiveHasStopTime: boolean;
}): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const hasDaily = (input.effectiveDailyCents ?? 0) > 0;
  const hasLifetime = (input.effectiveLifetimeCents ?? 0) > 0;

  if (hasDaily && hasLifetime) {
    issues.push(
      localIssue(
        "campaign",
        "BUDGET_DAILY_XOR_LIFETIME",
        "Defina daily_budget OU lifetime_budget na campanha, nunca os dois.",
        "Envie apenas um tipo de orçamento; informar um substitui o outro.",
        ["daily_budget", "lifetime_budget"],
      ),
    );
  }
  if (hasLifetime && !input.effectiveHasStopTime) {
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

/**
 * Ad-set budget on update: under a CBO parent the ad set carries no budget; in
 * ABO it carries exactly one (daily XOR lifetime), and lifetime needs end_time.
 */
export function validateAdSetBudgetUpdate(input: {
  parentUsesCampaignBudget: boolean;
  effectiveDailyCents?: number;
  effectiveLifetimeCents?: number;
  effectiveHasEndTime: boolean;
  /** Whether the caller is touching the ad-set budget at all. */
  budgetTouched: boolean;
}): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const hasDaily = (input.effectiveDailyCents ?? 0) > 0;
  const hasLifetime = (input.effectiveLifetimeCents ?? 0) > 0;

  if (input.parentUsesCampaignBudget) {
    if (input.budgetTouched && (hasDaily || hasLifetime)) {
      issues.push(
        localIssue(
          "adset",
          "ADSET_BUDGET_WITH_CBO",
          "A campanha usa orçamento (CBO); o conjunto não pode ter orçamento próprio.",
          "Remova daily_budget/lifetime_budget do conjunto, ou migre a campanha para ABO (migrateCampaignBudgetMode).",
          ["daily_budget", "lifetime_budget"],
        ),
      );
    }
    return issues;
  }

  if (hasDaily && hasLifetime) {
    issues.push(
      localIssue(
        "adset",
        "BUDGET_DAILY_XOR_LIFETIME",
        "Defina daily_budget OU lifetime_budget no conjunto, nunca os dois.",
        "Envie apenas um tipo de orçamento; informar um substitui o outro.",
        ["daily_budget", "lifetime_budget"],
      ),
    );
  }
  if (hasLifetime && !input.effectiveHasEndTime) {
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

// ───────────────────────── ended object guard ─────────────────────────

/**
 * A lifetime ad set / campaign whose flight already ended can only have its name
 * edited until a future end is set (Meta subcode 1487007). Surfaced as a WARNING
 * (not a blocker) so the caller can extend the window in the same change.
 */
export function endedFlightWarning(input: {
  level: CreateLevel;
  currentEndTime?: string;
  nextEndTime?: string;
  now?: Date;
}): CreateIssue[] {
  const end = input.nextEndTime ?? input.currentEndTime;
  if (!end) return [];
  const endMs = Date.parse(end);
  if (!Number.isFinite(endMs)) return [];
  const nowMs = (input.now ?? new Date()).getTime();
  if (endMs > nowMs) return [];
  return [
    localIssue(
      input.level,
      "FLIGHT_ALREADY_ENDED",
      "Este objeto tem término no passado; a Meta pode recusar edições além do nome.",
      "Defina um end_time/stop_time futuro na mesma atualização para reabrir a edição.",
      [input.level === "campaign" ? "stop_time" : "end_time"],
    ),
  ];
}

// ───────────────────────── review-trigger warnings ─────────────────────────

/**
 * Non-fatal advisories: changes Meta says can send an ad back to review
 * (best-practices.md). Returned as `warnings`, never blocking the update.
 */
const REVIEW_TRIGGER_FIELDS: Record<string, string> = {
  targeting: "segmentação (targeting)",
  optimization_goal: "meta de otimização (optimization_goal)",
  billing_event: "evento de cobrança (billing_event)",
  creative: "criativo (imagem/vídeo/texto/link/CTA)",
};

export function reviewTriggerWarnings(
  level: CreateLevel,
  changedFields: Iterable<string>,
): CreateIssue[] {
  const triggers = [...changedFields].filter((f) => f in REVIEW_TRIGGER_FIELDS);
  if (!triggers.length) return [];
  const human = triggers.map((f) => REVIEW_TRIGGER_FIELDS[f]).join(", ");
  return [
    localIssue(
      level,
      "MAY_TRIGGER_REVIEW",
      `Esta alteração (${human}) pode reenviar o anúncio para revisão da Meta.`,
      "Avise o usuário: a edição é aplicada, mas a entrega pode pausar até a nova aprovação. Mudanças de orçamento/lance/agenda não disparam revisão.",
    ),
  ];
}
