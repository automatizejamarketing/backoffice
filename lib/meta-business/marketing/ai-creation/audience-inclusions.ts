import { localIssue, type CreateIssue } from "../creation/types";
import type { CustomAudienceView } from "../audiences/types";
import type { DemographicLimits } from "./demographic-limits";
import { validateAppliedDemographicTargeting } from "./demographic-limits";

/** Session-only audience inclusion intent for the AI campaign review. */
export type AudienceInclusionIds = string[];

export type AudienceInclusionDerivation = {
  targeting?: Record<string, unknown>;
  issues: CreateIssue[];
};

export type AudienceTargetingExpectation = {
  demographics?: DemographicLimits;
  includedCustomAudienceIds?: readonly string[];
  excludedCustomAudienceIds?: readonly string[];
};

function cloneTargeting(
  targeting: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!targeting) return undefined;
  return JSON.parse(JSON.stringify(targeting)) as Record<string, unknown>;
}

function invalidIssue(): CreateIssue {
  return localIssue(
    "adset",
    "AUDIENCE_INCLUSION_INVALID",
    "A lista de inclusoes contem um identificador de publico invalido ou repetido.",
    "Selecione novamente apenas publicos personalizados acessiveis.",
    ["targeting", "custom_audiences"],
  );
}

/** Validate the answer independently of Meta, before a request is assembled. */
export function validateAudienceInclusionIds(
  ids: readonly string[] | undefined,
): CreateIssue[] {
  if (ids === undefined) return [];
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || id.trim().length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    return [invalidIssue()];
  }
  return [];
}

function hasHardDemographicLimit(targeting: Record<string, unknown>): boolean {
  return (
    targeting.age_min != null ||
    targeting.age_max != null ||
    (Array.isArray(targeting.genders) && targeting.genders.length > 0)
  );
}

function setAudienceExpansion(
  targeting: Record<string, unknown>,
  advantageAudience: 0 | 1,
): void {
  targeting.targeting_automation = {
    ...((targeting.targeting_automation as Record<string, unknown> | undefined) ?? {}),
    advantage_audience: advantageAudience,
  };
  targeting.targeting_relaxation_types = {
    ...((targeting.targeting_relaxation_types as Record<string, unknown> | undefined) ?? {}),
    custom_audience: advantageAudience,
    lookalike: advantageAudience,
  };
}

function withoutTargetingField(
  targeting: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(targeting).filter(([key]) => key !== field),
  );
}

function audienceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && "id" in entry) {
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }
    return [];
  });
}

function sameAudienceIds(actual: string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id) => expected.includes(id))
  );
}

function isExpansionDisabled(value: unknown): boolean {
  return value === 0 || value === false;
}

/** Verify audience-owned fields after Meta accepted an update or create request. */
export function validateAppliedAudienceTargeting(
  targeting: Record<string, unknown> | undefined,
  expected: AudienceTargetingExpectation,
): CreateIssue[] {
  const demographicIssues = validateAppliedDemographicTargeting(
    targeting,
    expected.demographics,
  );
  if (demographicIssues.length) return demographicIssues;

  if (!targeting) {
    return [
      localIssue(
        "adset",
        "AUDIENCE_TARGETING_VERIFY_FAILED",
        "A Meta nao devolveu a segmentacao efetiva do conjunto para conferencia.",
        "Nao ative a campanha; tente novamente para confirmar a segmentacao.",
        ["targeting"],
      ),
    ];
  }

  const checks: Array<{ actual: string[]; expected: readonly string[]; field: string }> = [];
  if (expected.includedCustomAudienceIds !== undefined) {
    checks.push({
      actual: audienceIds(targeting.custom_audiences),
      expected: expected.includedCustomAudienceIds,
      field: "custom_audiences",
    });
  }
  if (expected.excludedCustomAudienceIds !== undefined) {
    checks.push({
      actual: audienceIds(targeting.excluded_custom_audiences),
      expected: expected.excludedCustomAudienceIds,
      field: "excluded_custom_audiences",
    });
  }

  for (const check of checks) {
    if (!sameAudienceIds(check.actual, check.expected)) {
      return [
        localIssue(
          "adset",
          "AUDIENCE_TARGETING_VERIFY_FAILED",
          `A segmentacao efetiva retornada pela Meta nao corresponde a lista aplicada em ${check.field}.`,
          "Nao ative a campanha; revise os publicos e tente novamente.",
          ["targeting", check.field],
        ),
      ];
    }
  }

  if ((expected.includedCustomAudienceIds?.length ?? 0) > 0) {
    const automation = targeting.targeting_automation;
    const relaxation = targeting.targeting_relaxation_types;
    const advantageAudience =
      automation && typeof automation === "object"
        ? (automation as { advantage_audience?: unknown }).advantage_audience
        : undefined;
    const customAudienceExpansion =
      relaxation && typeof relaxation === "object"
        ? (relaxation as { custom_audience?: unknown }).custom_audience
        : undefined;
    const lookalikeExpansion =
      relaxation && typeof relaxation === "object"
        ? (relaxation as { lookalike?: unknown }).lookalike
        : undefined;
    if (
      !isExpansionDisabled(advantageAudience) ||
      !isExpansionDisabled(customAudienceExpansion) ||
      !isExpansionDisabled(lookalikeExpansion)
    ) {
      return [
        localIssue(
          "adset",
          "AUDIENCE_TARGETING_VERIFY_FAILED",
          "A inclusao foi retornada com Advantage+ ou expansao de publicos ainda ativa.",
          "Nao ative a campanha; tente novamente para aplicar a restricao completa.",
          ["targeting", "targeting_automation"],
        ),
      ];
    }
  }

  return [];
}

/**
 * Derive the exact targeting sent by preview/publication. An undefined value
 * preserves the base; an empty value clears inherited inclusions.
 */
export function applyAudienceInclusions(
  base: Record<string, unknown> | undefined,
  ids: readonly string[] | undefined,
  options: { preserveManualAdvantage?: boolean } = {},
): AudienceInclusionDerivation {
  const issues = validateAudienceInclusionIds(ids);
  const targeting = cloneTargeting(base);
  if (issues.length || ids === undefined) return { targeting, issues };
  if (!targeting) return { issues };

  if (ids.length > 0) {
    targeting.custom_audiences = ids.map((id) => ({ id }));
    setAudienceExpansion(targeting, 0);
    return { targeting, issues };
  }

  const clearedTargeting = withoutTargetingField(targeting, "custom_audiences");
  if (options.preserveManualAdvantage || hasHardDemographicLimit(clearedTargeting)) {
    setAudienceExpansion(clearedTargeting, 0);
  } else {
    setAudienceExpansion(clearedTargeting, 1);
  }
  return { targeting: clearedTargeting, issues };
}

/**
 * Validate the current library projection. Unknown capability and processing
 * status are allowed; an explicit denial, integrity block, or missing audience
 * blocks publication.
 */
export function validateAudienceInclusionsAgainstLibrary(
  ids: readonly string[] | undefined,
  audiences: readonly CustomAudienceView[],
): CreateIssue[] {
  const localIssues = validateAudienceInclusionIds(ids);
  if (localIssues.length || ids === undefined || ids.length === 0) {
    return localIssues;
  }

  const byId = new Map(audiences.map((audience) => [audience.id, audience]));
  return ids.flatMap((id) => {
    const audience = byId.get(id);
    if (!audience) {
      return [
        localIssue(
          "adset",
          "AUDIENCE_INCLUSION_NOT_FOUND",
          `O publico ${id} nao esta mais acessivel nesta conta.`,
          "Revise a biblioteca e remova ou troque a referencia antes de publicar.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    if (audience.availability?.include === "blocked") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_INCLUSION_INTEGRITY_BLOCKED",
          `O publico ${audience.name ?? id} esta bloqueado por integridade e nao pode ser usado como inclusao.`,
          "Corrija ou reconcilie a importacao, ou remova/troque esse publico.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    if (audience.capabilities.include === "unavailable") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_INCLUSION_UNAVAILABLE",
          `A permissao para incluir o publico ${audience.name ?? id} nao esta disponivel nesta conexao.`,
          "Reautorize ou atualize a biblioteca; se continuar indisponivel, remova/troque esse publico.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    return [];
  });
}
