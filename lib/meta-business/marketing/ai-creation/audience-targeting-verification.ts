import { localIssue, type CreateIssue } from "../creation/types";
import { readAdSet } from "../update/read-current";
import {
  validateAppliedAudienceTargeting,
  type AudienceTargetingExpectation,
} from "./audience-inclusions";
import { hasAppliedDemographicLimits } from "./demographic-limits";

/** Read every newly created ad set before activation and verify audience intent. */
export async function verifyAudienceTargetingOnAdSets(args: {
  accessToken: string;
  adSetIds: readonly string[];
  expected: AudienceTargetingExpectation;
}): Promise<CreateIssue[]> {
  if (
    !hasAppliedDemographicLimits(args.expected.demographics) &&
    args.expected.includedCustomAudienceIds === undefined &&
    args.expected.excludedCustomAudienceIds === undefined
  ) {
    return [];
  }

  try {
    const snapshots = await Promise.all(
      args.adSetIds.map((adSetId) => readAdSet(adSetId, args.accessToken)),
    );
    for (const [index, snapshot] of snapshots.entries()) {
      const issues = validateAppliedAudienceTargeting(
        (snapshot.targeting ?? {}) as Record<string, unknown>,
        args.expected,
      );
      if (issues.length) {
        return issues.map((issue) => ({
          ...issue,
          reason: `Conjunto ${args.adSetIds[index]}: ${issue.reason}`,
        }));
      }
    }
    return [];
  } catch {
    return [
      {
        ...localIssue(
          "adset",
          "AUDIENCE_TARGETING_VERIFY_FAILED",
          "Nao foi possivel ler de volta a segmentacao efetiva de todos os conjuntos.",
          "Nao ative a campanha; tente novamente para confirmar os publicos aplicados.",
          ["targeting"],
        ),
        transient: true,
      },
    ];
  }
}
