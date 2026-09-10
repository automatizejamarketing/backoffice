import { localIssue, type CreateIssue } from "../creation/types";
import type { CustomAudienceView } from "../audiences/types";

/**
 * Session-only audience exclusion intent for the AI campaign review.
 *
 * `undefined` means keep the audience inherited from the mold. An explicit
 * empty array clears the inherited exclusions. This module never changes
 * inclusions, demographics, placements or Advantage+ state.
 */
export type AudienceExclusionIds = string[];

export type AudienceExclusionDerivation = {
  targeting?: Record<string, unknown>;
  issues: CreateIssue[];
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
    "AUDIENCE_EXCLUSION_INVALID",
    "A lista de exclusões contém um identificador de público inválido ou repetido.",
    "Selecione novamente apenas públicos personalizados acessíveis.",
    ["targeting", "excluded_custom_audiences"],
  );
}

/** Validate the answer independently of Meta, before a request is assembled. */
export function validateAudienceExclusionIds(
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

/**
 * Derive the exact targeting sent by preview/publication. An empty answer
 * removes the field; omission preserves the full base targeting verbatim.
 */
export function applyAudienceExclusions(
  base: Record<string, unknown> | undefined,
  ids: readonly string[] | undefined,
): AudienceExclusionDerivation {
  const issues = validateAudienceExclusionIds(ids);
  const targeting = cloneTargeting(base);
  if (issues.length || ids === undefined) return { targeting, issues };
  if (!targeting) return { issues };

  if (ids.length === 0) {
    delete targeting.excluded_custom_audiences;
  } else {
    targeting.excluded_custom_audiences = ids.map((id) => ({ id }));
  }

  return { targeting, issues };
}

/**
 * Validate the current library projection. Unknown capability and processing
 * status are deliberately allowed; only an explicit permission denial,
 * integrity block, or disappeared audience blocks publication.
 */
export function validateAudienceExclusionsAgainstLibrary(
  ids: readonly string[] | undefined,
  audiences: readonly CustomAudienceView[],
): CreateIssue[] {
  const localIssues = validateAudienceExclusionIds(ids);
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
          "AUDIENCE_EXCLUSION_NOT_FOUND",
          `O público ${id} não está mais acessível nesta conta.`,
          "Revise a biblioteca e remova ou troque a referência antes de publicar.",
          ["targeting", "excluded_custom_audiences"],
        ),
      ];
    }
    if (audience.availability?.exclude === "blocked") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_EXCLUSION_INTEGRITY_BLOCKED",
          `O público ${audience.name ?? id} está bloqueado por integridade e não pode ser usado como exclusão.`,
          "Corrija ou reconcilie a importação, ou remova/troque esse público.",
          ["targeting", "excluded_custom_audiences"],
        ),
      ];
    }
    if (audience.capabilities.exclude === "unavailable") {
      return [
        localIssue(
          "adset",
          "AUDIENCE_EXCLUSION_UNAVAILABLE",
          `A permissão para excluir o público ${audience.name ?? id} não está disponível nesta conexão.`,
          "Reautorize ou atualize a biblioteca; se continuar indisponível, remova/troque esse público.",
          ["targeting", "excluded_custom_audiences"],
        ),
      ];
    }
    return [];
  });
}
