/**
 * Pure, reviewable demographic intent for the AI campaign wizard.
 *
 * `undefined` means that the user did not opt into advanced limits. `null` on
 * an individual field means restore that field to the targeting derived from
 * the current campaign answers. The helper deliberately changes only the
 * fields represented here and never invents a generic audience.
 */

export type DemographicAge = {
  min: number;
  max: number;
};

export type DemographicLimits = {
  age?: DemographicAge | null;
  genders?: number[] | null;
};

export type DemographicIssue = {
  stage: "local";
  level: "adset";
  code:
    | "DEMOGRAPHIC_AGE_RANGE_INVALID"
    | "DEMOGRAPHIC_GENDERS_INVALID"
    | "DEMOGRAPHIC_SPECIAL_CATEGORY_INCOMPATIBLE"
    | "DEMOGRAPHIC_CONTEXT_UNSUPPORTED"
    | "DEMOGRAPHIC_TARGETING_VERIFY_FAILED";
  reason: string;
  suggestion: string;
  field: ["targeting"];
};

export type DemographicDerivation = {
  targeting?: Record<string, unknown>;
  issues: DemographicIssue[];
};

const MIN_AGE = 13;
const MAX_AGE = 65;

function cloneTargeting(
  targeting: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!targeting) return undefined;
  return JSON.parse(JSON.stringify(targeting)) as Record<string, unknown>;
}

function ageIssue(): DemographicIssue {
  return {
    stage: "local",
    level: "adset",
    code: "DEMOGRAPHIC_AGE_RANGE_INVALID",
    reason: `A faixa etária deve ser inteira, de ${MIN_AGE} a ${MAX_AGE}, com o mínimo menor ou igual ao máximo.`,
    suggestion: `Informe uma faixa entre ${MIN_AGE} e ${MAX_AGE}.`,
    field: ["targeting"],
  };
}

function gendersIssue(): DemographicIssue {
  return {
    stage: "local",
    level: "adset",
    code: "DEMOGRAPHIC_GENDERS_INVALID",
    reason: "Selecione ao menos um gênero válido para a segmentação.",
    suggestion: "Escolha feminino, masculino ou ambos.",
    field: ["targeting"],
  };
}

function contextIssue(reason: string, suggestion: string): DemographicIssue {
  return {
    stage: "local",
    level: "adset",
    code: "DEMOGRAPHIC_CONTEXT_UNSUPPORTED",
    reason,
    suggestion,
    field: ["targeting"],
  };
}

export function hasAppliedDemographicLimits(
  limits: DemographicLimits | undefined,
): boolean {
  return limits?.age != null || limits?.genders != null;
}

/** Runtime boundary for JSON requests; typed callers are not a substitute for this check. */
export function isDemographicLimits(
  value: unknown,
): value is DemographicLimits | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const limits = value as Record<string, unknown>;
  if (limits.age !== undefined && limits.age !== null) {
    if (!limits.age || typeof limits.age !== "object" || Array.isArray(limits.age)) {
      return false;
    }
    const age = limits.age as Record<string, unknown>;
    if (typeof age.min !== "number" || typeof age.max !== "number") return false;
  }
  if (limits.genders !== undefined && limits.genders !== null) {
    if (
      !Array.isArray(limits.genders) ||
      limits.genders.some((gender) => typeof gender !== "number")
    ) {
      return false;
    }
  }
  return true;
}

const RESTRICTED_SPECIAL_CATEGORIES = new Set([
  "CREDIT",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "HOUSING",
]);

import {
  validateObjective,
  validateOptimizationForObjective,
} from "../creation/validation";

/**
 * Restricted special-ad categories cannot accept the same hard age/gender
 * controls as ordinary campaigns. Keep this check opt-in so an unapplied
 * override preserves the existing flow and its payload exactly.
 */
export function validateDemographicContext(args: {
  limits: DemographicLimits | undefined;
  specialAdCategories?: readonly string[];
  objective?: string;
  optimizationGoal?: string;
  targeting?: Record<string, unknown>;
}): DemographicIssue[] {
  if (!hasAppliedDemographicLimits(args.limits)) return [];

  const issues: DemographicIssue[] = [];
  if (args.objective) {
    const objectiveIssues = validateObjective(args.objective);
    if (objectiveIssues.length) {
      issues.push(contextIssue(objectiveIssues[0]!.reason, objectiveIssues[0]!.suggestion));
    } else if (args.optimizationGoal) {
      const optimizationIssues = validateOptimizationForObjective(
        args.objective,
        args.optimizationGoal,
      );
      if (optimizationIssues.length) {
        issues.push(
          contextIssue(
            optimizationIssues[0]!.reason,
            optimizationIssues[0]!.suggestion,
          ),
        );
      }
    }
  }

  if (
    !(args.specialAdCategories ?? []).some((category) =>
      RESTRICTED_SPECIAL_CATEGORIES.has(category),
    )
  ) {
    return issues;
  }

  if (args.limits?.genders != null && args.limits.genders.length > 0) {
    issues.push({
      stage: "local",
      level: "adset",
      code: "DEMOGRAPHIC_SPECIAL_CATEGORY_INCOMPATIBLE",
      reason: "A categoria especial restrita não permite limite demográfico por gênero.",
      suggestion: "Remova o limite de gênero para publicar esta campanha.",
      field: ["targeting"],
    });
  }
  if (
    args.limits?.age != null &&
    (args.limits.age.min < 18 || args.limits.age.max > 65)
  ) {
    issues.push({
      stage: "local",
      level: "adset",
      code: "DEMOGRAPHIC_SPECIAL_CATEGORY_INCOMPATIBLE",
      reason: "A categoria especial restrita exige idade mínima de 18 anos.",
      suggestion: "Defina a faixa etária a partir de 18 anos para publicar esta campanha.",
      field: ["targeting"],
    });
  }
  const geo = args.targeting?.geo_locations;
  if (
    geo &&
    typeof geo === "object" &&
    !Array.isArray(geo) &&
    Array.isArray((geo as Record<string, unknown>).zips) &&
    ((geo as Record<string, unknown>).zips as unknown[]).length > 0
  ) {
    issues.push(
      contextIssue(
        "A categoria especial restrita não permite segmentação por CEP.",
        "Remova os CEPs e use cidades ou localizações compatíveis.",
      ),
    );
  }
  return issues;
}

function targetingVerificationIssue(field: string): DemographicIssue {
  return {
    stage: "local",
    level: "adset",
    code: "DEMOGRAPHIC_TARGETING_VERIFY_FAILED",
    reason: `A segmentação efetiva retornada pela Meta não corresponde ao limite demográfico aplicado em ${field}.`,
    suggestion: "Não ative a campanha; revise os limites e tente novamente.",
    field: ["targeting"],
  };
}

function isDisabled(value: unknown): boolean {
  return value === 0 || value === false;
}

function isEnabled(value: unknown): boolean {
  return value === 1 || value === true;
}

function sameNumbers(actual: unknown, expected: readonly number[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const actualNumbers = actual.map((value) =>
    typeof value === "number" ? value : Number(value),
  );
  const sortedExpected = [...expected].sort((a, b) => a - b);
  const sortedActual = actualNumbers.sort((a, b) => a - b);
  return sortedActual.join(",") === sortedExpected.join(",");
}

/**
 * Verify the hard demographic fields after Meta accepted a create or update.
 * An undefined/null field is deliberately not checked: its current value is
 * inherited from the path's base targeting and must remain untouched.
 */
export function validateAppliedDemographicTargeting(
  targeting: Record<string, unknown> | undefined,
  expected: DemographicLimits | undefined,
): DemographicIssue[] {
  if (!hasAppliedDemographicLimits(expected)) return [];
  if (!targeting) return [targetingVerificationIssue("targeting")];

  if (expected?.age != null) {
    if (
      Number(targeting.age_min) !== expected.age.min ||
      Number(targeting.age_max) !== expected.age.max
    ) {
      return [targetingVerificationIssue("idade")];
    }
  }

  if (expected?.genders != null && !sameNumbers(targeting.genders, expected.genders)) {
    return [targetingVerificationIssue("gênero")];
  }

  const automation = targeting.targeting_automation;
  const automationRecord =
    automation && typeof automation === "object"
      ? (automation as Record<string, unknown>)
      : undefined;
  const relaxation = targeting.targeting_relaxation_types;
  const relaxationRecord =
    relaxation && typeof relaxation === "object"
      ? (relaxation as Record<string, unknown>)
      : undefined;
  const individualSetting = automationRecord?.individual_setting;
  const individualRecord =
    individualSetting && typeof individualSetting === "object"
      ? (individualSetting as Record<string, unknown>)
      : undefined;

  if (
    !isDisabled(automationRecord?.advantage_audience) ||
    !isDisabled(relaxationRecord?.custom_audience) ||
    !isDisabled(relaxationRecord?.lookalike) ||
    isEnabled(individualRecord?.age) ||
    isEnabled(individualRecord?.gender)
  ) {
    return [targetingVerificationIssue("expansão de público")];
  }

  return [];
}

/**
 * Derive the exact targeting that preview and publication must share.
 * Existing targeting is copied, and only an explicitly applied age or gender
 * is replaced. Restoring a field leaves the current base untouched.
 */
export function applyDemographicLimits(
  base: Record<string, unknown> | undefined,
  limits: DemographicLimits | undefined,
): DemographicDerivation {
  const targeting = cloneTargeting(base);
  const issues: DemographicIssue[] = [];

  if (!targeting) {
    if (!hasAppliedDemographicLimits(limits)) return { targeting: undefined, issues };
    return { issues };
  }

  if (limits?.age != null) {
    const { min, max } = limits.age;
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < MIN_AGE ||
      max > MAX_AGE ||
      min > max
    ) {
      issues.push(ageIssue());
    } else {
      targeting.age_min = min;
      targeting.age_max = max;
    }
  }

  if (limits?.genders != null) {
    const genders = limits.genders;
    if (
      !Array.isArray(genders) ||
      genders.length === 0 ||
      genders.some(
        (gender) => !Number.isInteger(gender) || (gender !== 1 && gender !== 2),
      ) ||
      new Set(genders).size !== genders.length
    ) {
      issues.push(gendersIssue());
    } else {
      targeting.genders = [...genders];
    }
  }

  if (issues.length) return { issues };

  if (hasAppliedDemographicLimits(limits)) {
    const automation: Record<string, unknown> = {
      ...((targeting.targeting_automation as Record<string, unknown> | undefined) ?? {}),
      advantage_audience: 0,
    };
    const individualSetting = automation.individual_setting;
    if (individualSetting && typeof individualSetting === "object") {
      automation.individual_setting = {
        ...(individualSetting as Record<string, unknown>),
        age: false,
        gender: false,
      };
    }
    targeting.targeting_automation = {
      ...automation,
    };
    targeting.targeting_relaxation_types = {
      ...((targeting.targeting_relaxation_types as Record<string, unknown> | undefined) ?? {}),
      custom_audience: 0,
      lookalike: 0,
    };
  }

  return { targeting, issues };
}
