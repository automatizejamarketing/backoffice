import type { AdSetTargeting } from "./types";

export type MetaInterestSearchResult = {
  id: string;
  name: string;
  type?: "interests" | string;
  audience_size?: number;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
  description?: string;
  valid?: boolean;
};

export type SelectedInterest = {
  id: string;
  name: string;
  audience_size?: number;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
  description?: string;
};

export type InterestTargetingGroup = {
  /** UI-only identifier; never sent to Meta */
  id: string;
  interests: SelectedInterest[];
};

export type InterestTargetingValue = {
  includeGroups: InterestTargetingGroup[];
  exclusions: SelectedInterest[];
};

export type MetaFlexibleSpec = Array<{
  interests?: Array<{ id: string; name?: string }>;
}>;

export type MetaInterestExclusions = {
  interests?: Array<{ id: string; name?: string }>;
  [key: string]: unknown;
};

export type NormalizeInterestTargetingResult =
  | { ok: true; value: InterestTargetingValue }
  | { ok: false; error: string };

export const MAX_INCLUDE_GROUPS = 25;
export const MAX_INTERESTS_PER_GROUP = 1000;
export const UI_MAX_INTERESTS_PER_GROUP = 50;

export const EMPTY_INTEREST_TARGETING_VALUE: InterestTargetingValue = {
  includeGroups: [],
  exclusions: [],
};

/** Default UI state: one empty include group for editing */
export function createDefaultInterestTargetingValue(): InterestTargetingValue {
  return {
    includeGroups: [{ id: createGroupId(), interests: [] }],
    exclusions: [],
  };
}

export function createGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `group_${crypto.randomUUID()}`;
  }
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function toSelectedInterest(
  entity: Record<string, unknown>,
): SelectedInterest | null {
  const id =
    typeof entity.id === "string"
      ? entity.id
      : typeof entity.id === "number"
        ? String(entity.id)
        : null;
  const name = typeof entity.name === "string" ? entity.name.trim() : null;
  if (!id || !name) return null;

  return {
    id,
    name,
    ...(typeof entity.audience_size === "number" && {
      audience_size: entity.audience_size,
    }),
    ...(typeof entity.audience_size_lower_bound === "number" && {
      audience_size_lower_bound: entity.audience_size_lower_bound,
    }),
    ...(typeof entity.audience_size_upper_bound === "number" && {
      audience_size_upper_bound: entity.audience_size_upper_bound,
    }),
    ...(Array.isArray(entity.path) && {
      path: entity.path.filter((p): p is string => typeof p === "string"),
    }),
    ...(typeof entity.description === "string" && {
      description: entity.description,
    }),
  };
}

export function normalizeInterestTargetingValue(
  value: InterestTargetingValue,
): NormalizeInterestTargetingResult {
  const includeIds = new Set<string>();
  const normalizedGroups: InterestTargetingGroup[] = [];

  for (const group of value.includeGroups) {
    const seenInGroup = new Set<string>();
    const interests: SelectedInterest[] = [];

    for (const interest of group.interests) {
      const id = interest.id?.trim();
      const name = interest.name?.trim();
      if (!id || !name) continue;
      if (seenInGroup.has(id)) continue;
      if (interests.length >= MAX_INTERESTS_PER_GROUP) {
        return {
          ok: false,
          error: `Cada grupo pode ter no máximo ${MAX_INTERESTS_PER_GROUP} interesses.`,
        };
      }
      seenInGroup.add(id);
      includeIds.add(id);
      interests.push({ ...interest, id, name });
    }

    if (interests.length > 0) {
      normalizedGroups.push({
        id: group.id || createGroupId(),
        interests,
      });
    }
  }

  if (normalizedGroups.length > MAX_INCLUDE_GROUPS) {
    return {
      ok: false,
      error: `No máximo ${MAX_INCLUDE_GROUPS} grupos de inclusão são permitidos.`,
    };
  }

  const seenExclusions = new Set<string>();
  const exclusions: SelectedInterest[] = [];

  for (const interest of value.exclusions) {
    const id = interest.id?.trim();
    const name = interest.name?.trim();
    if (!id || !name) continue;
    if (seenExclusions.has(id)) continue;
    if (includeIds.has(id)) {
      return {
        ok: false,
        error:
          "Um interesse não pode estar incluído e excluído ao mesmo tempo.",
      };
    }
    seenExclusions.add(id);
    exclusions.push({ ...interest, id, name });
  }

  return {
    ok: true,
    value: { includeGroups: normalizedGroups, exclusions },
  };
}

export function buildFlexibleSpecFromInterestTargeting(
  value: InterestTargetingValue,
): MetaFlexibleSpec | undefined {
  const normalized = normalizeInterestTargetingValue(value);
  if (!normalized.ok) return undefined;

  const groups = normalized.value.includeGroups.filter(
    (g) => g.interests.length > 0,
  );
  if (groups.length === 0) return undefined;

  return groups.map((group) => ({
    interests: group.interests.map((i) => ({ id: i.id, name: i.name })),
  }));
}

export function buildExclusionsFromInterestTargeting(
  value: InterestTargetingValue,
  previousExclusions?: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  const normalized = normalizeInterestTargetingValue(value);
  if (!normalized.ok) return undefined;

  const merged: Record<string, unknown> = {};

  if (previousExclusions && typeof previousExclusions === "object") {
    for (const [key, val] of Object.entries(previousExclusions)) {
      if (key !== "interests") {
        merged[key] = val;
      }
    }
  }

  if (normalized.value.exclusions.length > 0) {
    merged.interests = normalized.value.exclusions.map((i) => ({
      id: i.id,
      name: i.name,
    }));
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function interestTargetingFromMetaTargeting(
  targeting: AdSetTargeting | null | undefined,
): InterestTargetingValue {
  if (!targeting) return createDefaultInterestTargetingValue();

  const includeGroups: InterestTargetingGroup[] = [];
  const flexibleSpec = targeting.flexible_spec;

  if (Array.isArray(flexibleSpec)) {
    for (const spec of flexibleSpec) {
      const interests = spec.interests;
      if (!Array.isArray(interests) || interests.length === 0) continue;

      const mapped: SelectedInterest[] = [];
      for (const item of interests) {
        if (!item || typeof item !== "object") continue;
        const selected = toSelectedInterest(item as Record<string, unknown>);
        if (selected) mapped.push(selected);
      }

      if (mapped.length > 0) {
        includeGroups.push({ id: createGroupId(), interests: mapped });
      }
    }
  }

  if (includeGroups.length === 0 && Array.isArray(targeting.interests)) {
    const mapped: SelectedInterest[] = [];
    for (const item of targeting.interests) {
      if (!item || typeof item !== "object") continue;
      const selected = toSelectedInterest(item as Record<string, unknown>);
      if (selected) mapped.push(selected);
    }
    if (mapped.length > 0) {
      includeGroups.push({ id: createGroupId(), interests: mapped });
    }
  }

  const exclusions: SelectedInterest[] = [];
  const rawExclusions = targeting.exclusions as
    | Record<string, unknown>
    | undefined;
  const exclusionInterests = rawExclusions?.interests;
  if (Array.isArray(exclusionInterests)) {
    for (const item of exclusionInterests) {
      if (!item || typeof item !== "object") continue;
      const selected = toSelectedInterest(item as Record<string, unknown>);
      if (selected) exclusions.push(selected);
    }
  }

  if (includeGroups.length === 0) {
    return { includeGroups: [{ id: createGroupId(), interests: [] }], exclusions };
  }

  return { includeGroups, exclusions };
}

export function getInterestTargetingIds(value: InterestTargetingValue): string[] {
  const ids = new Set<string>();
  for (const group of value.includeGroups) {
    for (const interest of group.interests) {
      if (interest.id) ids.add(interest.id);
    }
  }
  for (const interest of value.exclusions) {
    if (interest.id) ids.add(interest.id);
  }
  return [...ids];
}

export function areInterestTargetingValuesEqual(
  a: InterestTargetingValue,
  b: InterestTargetingValue,
): boolean {
  if (a.includeGroups.length !== b.includeGroups.length) return false;
  if (a.exclusions.length !== b.exclusions.length) return false;

  for (let i = 0; i < a.includeGroups.length; i++) {
    const groupA = a.includeGroups[i];
    const groupB = b.includeGroups[i];
    const idsA = groupA.interests.map((x) => x.id).sort().join(",");
    const idsB = groupB.interests.map((x) => x.id).sort().join(",");
    if (idsA !== idsB) return false;
  }

  const exA = a.exclusions.map((x) => x.id).sort().join(",");
  const exB = b.exclusions.map((x) => x.id).sort().join(",");
  return exA === exB;
}

export function hasInterestTargetingConfigured(
  value: InterestTargetingValue,
): boolean {
  const hasIncludes = value.includeGroups.some((g) => g.interests.length > 0);
  const hasExclusions = value.exclusions.length > 0;
  return hasIncludes || hasExclusions;
}

export function applyInterestTargetingToMetaTargeting(
  targeting: Record<string, unknown>,
  interestTargeting: InterestTargetingValue | undefined,
  previousTargeting?: AdSetTargeting | null,
): void {
  const previousExclusions =
    (previousTargeting?.exclusions as Record<string, unknown> | undefined) ??
    (targeting.exclusions as Record<string, unknown> | undefined);

  if (!interestTargeting) return;

  const normalized = normalizeInterestTargetingValue(interestTargeting);
  if (!normalized.ok) return;

  const flexibleSpec = buildFlexibleSpecFromInterestTargeting(normalized.value);
  if (flexibleSpec) {
    targeting.flexible_spec = flexibleSpec;
  } else {
    delete targeting.flexible_spec;
  }

  delete targeting.interests;

  const exclusions = buildExclusionsFromInterestTargeting(
    normalized.value,
    previousExclusions,
  );
  if (exclusions) {
    targeting.exclusions = exclusions;
  } else {
    delete targeting.exclusions;
  }
}

/** Preserve detailed targeting fields not edited in the UI */
export function preserveDetailedTargetingFields(
  previousTargeting: AdSetTargeting | null | undefined,
  newTargeting: Record<string, unknown>,
  options?: { replaceInterestTargeting?: boolean },
): Record<string, unknown> {
  if (!previousTargeting) return newTargeting;

  const preserveKeys = [
    "behaviors",
    "demographics",
    "excluded_geo_locations",
    "locales",
    "device_platforms",
    "messenger_positions",
    "audience_network_positions",
  ] as const;

  for (const key of preserveKeys) {
    if (newTargeting[key] === undefined && previousTargeting[key] !== undefined) {
      newTargeting[key] = previousTargeting[key];
    }
  }

  if (!options?.replaceInterestTargeting) {
    if (
      newTargeting.flexible_spec === undefined &&
      previousTargeting.flexible_spec !== undefined
    ) {
      newTargeting.flexible_spec = previousTargeting.flexible_spec;
    }
    if (
      newTargeting.interests === undefined &&
      previousTargeting.interests !== undefined
    ) {
      newTargeting.interests = previousTargeting.interests;
    }
    if (
      newTargeting.exclusions === undefined &&
      previousTargeting.exclusions !== undefined
    ) {
      newTargeting.exclusions = previousTargeting.exclusions;
    }
  }

  return newTargeting;
}
