export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConsultantFilterId = string | "all" | "unassigned";

export function normalizeConsultantFilterId(
  raw: string | string[] | undefined,
): ConsultantFilterId {
  const trimmed = firstSearchParam(raw)?.trim();
  if (trimmed === "unassigned") return trimmed;
  if (trimmed && uuidPattern.test(trimmed)) return trimmed;
  return "all";
}
