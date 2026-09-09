export type WebsiteAudienceCriterion = "visitors" | "url" | "event";
export type WebsiteAudienceSelection = { pixelId: string; criterion: WebsiteAudienceCriterion; retentionDays: number; url?: string; event?: string };
const DAY = 86_400;
export function buildWebsiteAudienceRule(selection: WebsiteAudienceSelection) {
  if (!selection.pixelId.trim() || !Number.isInteger(selection.retentionDays) || selection.retentionDays < 1 || selection.retentionDays > 180) throw new Error("O período do público do site deve estar entre 1 e 180 dias.");
  const filter = selection.criterion === "url" ? selection.url?.trim() ? { field: "url", operator: "i_contains", value: selection.url.trim() } : null : { field: "event", operator: "eq", value: selection.criterion === "event" ? selection.event?.trim() : "PageView" };
  if (!filter || !filter.value) throw new Error("Informe o filtro exigido para este critério do site.");
  return { inclusions: { operator: "or", rules: [{ event_sources: [{ id: selection.pixelId, type: "pixel" }], retention_seconds: selection.retentionDays * DAY, filter: { operator: "and", filters: [filter] } }] } };
}
export function parseWebsiteAudienceRule(rule: unknown): WebsiteAudienceSelection | null {
  if (!rule || typeof rule !== "object") return null;
  const inclusions = (rule as { inclusions?: { operator?: unknown; rules?: unknown[] } }).inclusions;
  const item = inclusions?.operator === "or" && inclusions.rules?.length === 1 ? inclusions.rules[0] as { event_sources?: Array<{ id?: unknown; type?: unknown }>; retention_seconds?: unknown; filter?: { operator?: unknown; filters?: Array<{ field?: unknown; operator?: unknown; value?: unknown }> } } : null;
  const source = item?.event_sources?.length === 1 ? item.event_sources[0] : null; const filter = item?.filter?.operator === "and" && item.filter.filters?.length === 1 ? item.filter.filters[0] : null; const seconds = item?.retention_seconds;
  if (source?.type !== "pixel" || typeof source.id !== "string" || !Number.isInteger(seconds) || seconds! < DAY || seconds! > 180 * DAY || seconds! % DAY !== 0 || !filter || typeof filter.value !== "string") return null;
  const retentionDays = seconds! / DAY;
  if (filter.field === "event" && filter.operator === "eq") return { pixelId: source.id, criterion: filter.value === "PageView" ? "visitors" : "event", ...(filter.value === "PageView" ? {} : { event: filter.value }), retentionDays };
  return filter.field === "url" && filter.operator === "i_contains" ? { pixelId: source.id, criterion: "url", url: filter.value, retentionDays } : null;
}
