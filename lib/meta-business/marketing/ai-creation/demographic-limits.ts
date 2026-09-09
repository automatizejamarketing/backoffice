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
    | "DEMOGRAPHIC_GENDERS_INVALID";
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

function hasAppliedField(limits: DemographicLimits | undefined): boolean {
  return limits?.age != null || limits?.genders != null;
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
    if (!hasAppliedField(limits)) return { targeting: undefined, issues };
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

  if (hasAppliedField(limits)) {
    targeting.targeting_automation = {
      ...((targeting.targeting_automation as Record<string, unknown> | undefined) ?? {}),
      advantage_audience: 0,
    };
    targeting.targeting_relaxation_types = {
      ...((targeting.targeting_relaxation_types as Record<string, unknown> | undefined) ?? {}),
      custom_audience: 0,
      lookalike: 0,
    };
  }

  return { targeting, issues };
}
