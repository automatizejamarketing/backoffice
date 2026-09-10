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

/** The audience fields that must survive Meta's create/update round trip. */
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
    "A lista de inclusões contém um identificador de público inválido ou repetido.",
    "Selecione novamente apenas públicos personalizados acessíveis.",
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

function setAudienceExpansion(
  targeting: Record<string, unknown>,
  advantageAudience: 0 | 1,
  options: { disableIndividualSuggestions?: boolean } = {},
): void {
  const automation: Record<string, unknown> = {
    ...((targeting.targeting_automation as Record<string, unknown> | undefined) ?? {}),
    advantage_audience: advantageAudience,
  };
  if (options.disableIndividualSuggestions) {
    const individualSetting = automation.individual_setting;
    if (individualSetting && typeof individualSetting === "object") {
      automation.individual_setting = {
        ...(individualSetting as Record<string, unknown>),
        age: false,
        gender: false,
      };
    }
  }
  targeting.targeting_automation = automation;
  targeting.targeting_relaxation_types = {
    ...((targeting.targeting_relaxation_types as Record<string, unknown> | undefined) ?? {}),
    custom_audience: advantageAudience,
    lookalike: advantageAudience,
  };
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

function uniqueAudienceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Effective audience facts shared by the fallback and proven-campaign reviews. */
export type AudienceTargetingFacts = {
  includedIds: string[];
  excludedIds: string[];
  effectiveIncludedIds: string[];
  overlappingIds: string[];
};

export function summarizeAudienceTargeting(
  targeting: Record<string, unknown>,
): AudienceTargetingFacts {
  const includedIds = uniqueAudienceIds(audienceIds(targeting.custom_audiences));
  const excludedIds = uniqueAudienceIds(
    audienceIds(targeting.excluded_custom_audiences),
  );
  const excluded = new Set(excludedIds);
  const overlappingIds = includedIds.filter((id) => excluded.has(id));

  return {
    includedIds,
    excludedIds,
    effectiveIncludedIds: includedIds.filter((id) => !excluded.has(id)),
    overlappingIds,
  };
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

function isExpansionEnabled(value: unknown): boolean {
  return value === 1 || value === true;
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
        "A Meta não devolveu a segmentação efetiva do conjunto para conferência.",
        "Não ative a campanha; tente novamente para confirmar a segmentação.",
        ["targeting"],
      ),
    ];
  }

  const checks: Array<{
    actual: string[];
    expected: readonly string[];
    field: "custom_audiences" | "excluded_custom_audiences";
  }> = [];
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
          `A segmentação efetiva retornada pela Meta não corresponde à lista aplicada em ${check.field}.`,
          "Não ative a campanha; revise os públicos e tente novamente.",
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
    const individualSetting =
      automation && typeof automation === "object"
        ? (automation as { individual_setting?: unknown }).individual_setting
        : undefined;
    const individualAgeSuggestion =
      individualSetting && typeof individualSetting === "object"
        ? (individualSetting as { age?: unknown }).age
        : undefined;
    const individualGenderSuggestion =
      individualSetting && typeof individualSetting === "object"
        ? (individualSetting as { gender?: unknown }).gender
        : undefined;
    if (
      !isExpansionDisabled(advantageAudience) ||
      !isExpansionDisabled(customAudienceExpansion) ||
      !isExpansionDisabled(lookalikeExpansion) ||
      isExpansionEnabled(individualAgeSuggestion) ||
      isExpansionEnabled(individualGenderSuggestion)
    ) {
      return [
        localIssue(
          "adset",
          "AUDIENCE_TARGETING_VERIFY_FAILED",
          "A inclusão foi retornada com Advantage+ ou expansão de públicos ainda ativa.",
          "Não ative a campanha; tente novamente para aplicar a restrição completa.",
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
    setAudienceExpansion(targeting, 0, { disableIndividualSuggestions: true });
    return { targeting, issues };
  }

  const hadIncludedAudience = audienceIds(targeting.custom_audiences).length > 0;
  delete targeting.custom_audiences;
  // Existing age/gender fields may be inherited from a mold. They are not
  // evidence that this journey applied a hard demographic limit, so they must
  // not keep Advantage+ disabled after the last inclusion is cleared.
  if (options.preserveManualAdvantage) {
    setAudienceExpansion(targeting, 0);
  } else if (hadIncludedAudience) {
    setAudienceExpansion(targeting, 1);
  }
  return { targeting, issues };
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
          `O público ${id} não está mais acessível nesta conta.`,
          "Revise a biblioteca e remova ou troque a referência antes de publicar.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    if (audience.availability?.include === "blocked") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_INCLUSION_INTEGRITY_BLOCKED",
          `O público ${audience.name ?? id} está bloqueado por integridade e não pode ser usado como inclusão.`,
          "Corrija ou reconcilie a importação, ou remova/troque esse público.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    if (audience.capabilities.include === "unavailable") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_INCLUSION_UNAVAILABLE",
          `A permissão para incluir o público ${audience.name ?? id} não está disponível nesta conexão.`,
          "Reautorize ou atualize a biblioteca; se continuar indisponível, remova/troque esse público.",
          ["targeting", "custom_audiences"],
        ),
      ];
    }
    return [];
  });
}
