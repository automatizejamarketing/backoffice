import type {
  InterestTargetingGroup,
  InterestTargetingValue,
  SelectedInterest,
} from "./interest-targeting-types";
import {
  getInterestTargetingIds,
  hasInterestTargetingConfigured,
  normalizeInterestTargetingValue,
} from "./interest-targeting-types";
import {
  INTEREST_VALIDATION_ERROR_MESSAGE,
  validateInterestIdsWithMeta,
} from "./validate-interest-ids";

function isSelectedInterest(raw: unknown): raw is SelectedInterest {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string";
}

function isInterestTargetingGroup(raw: unknown): raw is InterestTargetingGroup {
  if (!raw || typeof raw !== "object") return false;
  const group = raw as Record<string, unknown>;
  return (
    typeof group.id === "string" &&
    Array.isArray(group.interests) &&
    group.interests.every(isSelectedInterest)
  );
}

function isInterestTargetingValue(raw: unknown): raw is InterestTargetingValue {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return (
    Array.isArray(value.includeGroups) &&
    value.includeGroups.every(isInterestTargetingGroup) &&
    Array.isArray(value.exclusions) &&
    value.exclusions.every(isSelectedInterest)
  );
}

export type ParseInterestTargetingResult =
  | { ok: true; value: InterestTargetingValue | undefined }
  | { ok: false; error: string };

export function parseInterestTargetingFromRequest(
  raw: unknown,
): ParseInterestTargetingResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }

  if (!isInterestTargetingValue(raw)) {
    return {
      ok: false,
      error: "Formato inválido de público de interesse.",
    };
  }

  const normalized = normalizeInterestTargetingValue(raw);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  if (!hasInterestTargetingConfigured(normalized.value)) {
    return { ok: true, value: undefined };
  }

  return { ok: true, value: normalized.value };
}

export type ValidateInterestTargetingForWriteResult =
  | { ok: true; value: InterestTargetingValue | undefined }
  | { ok: false; message: string; invalidIds?: string[] };

export async function validateInterestTargetingForWrite(
  accessToken: string,
  raw: unknown,
  locale?: string,
): Promise<ValidateInterestTargetingForWriteResult> {
  const parsed = parseInterestTargetingFromRequest(raw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }

  if (!parsed.value) {
    return { ok: true, value: undefined };
  }

  const ids = getInterestTargetingIds(parsed.value);
  if (ids.length === 0) {
    return { ok: true, value: undefined };
  }

  const validation = await validateInterestIdsWithMeta(accessToken, ids, locale);
  if (!validation.valid) {
    return {
      ok: false,
      message: INTEREST_VALIDATION_ERROR_MESSAGE,
      invalidIds: validation.invalidIds,
    };
  }

  return { ok: true, value: parsed.value };
}

export function parseInterestTargetingForEdit(
  raw: unknown,
): ParseInterestTargetingResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }

  if (!isInterestTargetingValue(raw)) {
    return {
      ok: false,
      error: "Formato inválido de público de interesse.",
    };
  }

  const normalized = normalizeInterestTargetingValue(raw);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  return { ok: true, value: normalized.value };
}

export async function validateInterestTargetingForEdit(
  accessToken: string,
  raw: unknown,
  locale?: string,
): Promise<ValidateInterestTargetingForWriteResult> {
  const parsed = parseInterestTargetingForEdit(raw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }

  if (!parsed.value) {
    return { ok: true, value: undefined };
  }

  const ids = getInterestTargetingIds(parsed.value);
  if (ids.length === 0) {
    return { ok: true, value: parsed.value };
  }

  const validation = await validateInterestIdsWithMeta(accessToken, ids, locale);
  if (!validation.valid) {
    return {
      ok: false,
      message: INTEREST_VALIDATION_ERROR_MESSAGE,
      invalidIds: validation.invalidIds,
    };
  }

  return { ok: true, value: parsed.value };
}
