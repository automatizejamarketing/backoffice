export const USER_CONTACT_MARKS_COOKIE_NAME = "bo_user_contacted";
export const USER_CONTACT_MARKS_STORAGE_KEY =
  "automatize-backoffice.users-contacted.v1";
export const USER_CONTACT_MARKS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const USER_CONTACT_MARKS_MAX_IDS = 150;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/i;

function expandCompactUuid(value: string): string | null {
  if (UUID_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  if (!COMPACT_UUID_PATTERN.test(value)) {
    return null;
  }
  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function compactUuid(value: string): string {
  return value.replace(/-/g, "");
}

export function parseUserContactMarks(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];

  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    value = raw.trim();
  }

  let parsed: unknown = value;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = value.split(/[.,]/);
  }

  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "string"
      ? parsed.split(/[.,]/)
      : [];

  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = expandCompactUuid(value.trim());
    if (id) unique.add(id);
  }

  return [...unique];
}

export function serializeUserContactMarks(ids: string[]): string {
  const unique = new Set<string>();
  for (const id of ids) {
    const normalized = expandCompactUuid(id);
    if (normalized) unique.add(normalized);
  }

  return JSON.stringify(
    [...unique].slice(-USER_CONTACT_MARKS_MAX_IDS).map(compactUuid),
  );
}

export function setUserContactMark(
  ids: string[],
  userId: string,
  contacted: boolean,
): string[] {
  const unique = new Set(parseUserContactMarks(JSON.stringify(ids)));
  const normalized = expandCompactUuid(userId);
  if (!normalized) return [...unique];

  if (contacted) {
    unique.add(normalized);
  } else {
    unique.delete(normalized);
  }

  return [...unique];
}
