/**
 * Normalize a display name into a kebab-case slug: NFD-normalize, strip
 * diacritics (combining nonspacing marks), lowercase, collapse non-alphanumerics
 * into hyphens, trim hyphens, cap length. Falls back to "link" when empty.
 *
 * Pure and dependency-free so it can be imported by both the server-side queries
 * and the client UI (for an approximate slug preview — the real slug may get a
 * uniqueness suffix appended server-side).
 *
 * Example: "Dudu Donos de Hambúrgueria" -> "dudu-donos-de-hamburgueria".
 */
export function slugifyName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = base.slice(0, 80).replace(/-+$/g, "");
  return capped || "link";
}
