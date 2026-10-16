export function parseAlertCompletionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.some((id) => typeof id !== "string" || id.trim().length === 0))
    return null;
  return [...new Set(value as string[])];
}
