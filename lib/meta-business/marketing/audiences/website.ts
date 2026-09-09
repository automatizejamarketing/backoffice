export type WebsiteAudienceCriterion = "visitors" | "url" | "event";
export type WebsiteAudienceSelection = { pixelId: string; criterion: WebsiteAudienceCriterion; retentionDays: number; url?: string; event?: string };
export type WebsiteSource = { id: string; name?: string; lastFiredTime?: string; isUnavailable?: boolean; observedEvents?: string[]; observedEventsStatus?: "available" | "unavailable" | "unknown"; observedEventsObservedAt?: string };
export type WebsiteSourceEvidence = { access: "available" | "unavailable" | "unknown"; activity: "available" | "unavailable" | "unknown"; availability: "available" | "unavailable" | "unknown"; observedEvents: string[]; observedEventsStatus: "available" | "unavailable" | "unknown"; observedEventsObservedAt?: string; guidance: string };
export function resolveWebsiteSourceEvidence(sources: ReadonlyArray<WebsiteSource>, pixelId: string): WebsiteSourceEvidence {
  const source = sources.find((candidate) => candidate.id === pixelId);
  if (!source || source.isUnavailable === true) return { access: "unavailable", activity: "unknown", availability: "unavailable", observedEvents: [], observedEventsStatus: "unknown", guidance: "O Pixel escolhido não está acessível para esta conta. Configure ou reautorize o rastreamento existente; esta tela não instala Pixel nem CAPI." };
  const active = Boolean(source.lastFiredTime);
  const observedEvents = [...(source.observedEvents ?? [])];
  const observedEventsStatus = source.observedEventsStatus ?? (observedEvents.length ? "available" : "unknown");
  return { access: "available", activity: active ? "available" : "unavailable", availability: "unknown", observedEvents, observedEventsStatus, ...(source.observedEventsObservedAt ? { observedEventsObservedAt: source.observedEventsObservedAt } : {}), guidance: active ? "O Pixel tem atividade observada, mas eventos específicos só podem ser oferecidos quando recebidos por este Pixel forem confirmados. A disponibilidade final do público é decidida pela Meta." : "O Pixel está acessível, mas não há atividade recebida observada. Configure ou reautorize o rastreamento existente; esta tela não instala Pixel nem CAPI." };
}
function positiveEventCount(value: unknown): boolean { if (typeof value === "number") return value > 0; if (typeof value === "string" && value.trim() !== "") return Number(value) > 0; return false; }
/** Extracts only event names present in the source-specific stats response. */
export function extractObservedWebsiteEvents(response: unknown): string[] { if (!response || typeof response !== "object") return []; const data = (response as { data?: unknown }).data; if (Array.isArray(data)) return Array.from(new Set(data.flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const item = entry as Record<string, unknown>; const name = [item.event, item.event_name, item.name].find((value): value is string => typeof value === "string" && value.trim() !== ""); if (!name) return []; const count = item.count ?? item.event_count ?? item.value; return count === undefined || positiveEventCount(count) ? [name.trim()] : []; }))); if (!data || typeof data !== "object") return []; return Object.entries(data as Record<string, unknown>).filter(([name, count]) => name.trim() !== "" && positiveEventCount(count)).map(([name]) => name.trim()); }
export type WebsitePeriodEvidence = { sourceId?: string; criterion: WebsiteAudienceCriterion; initialDays: number | null; editable: "yes" | "no" | "unknown"; metaMinimumDays: number | null; metaMaximumDays: number | null; localValidationMaximumDays: number | null; unit: "days"; historicalFill: "available" | "unavailable" | "unknown"; observedAt: string; context: string; source: string };
export const WEBSITE_PERIOD_EVIDENCE: Record<WebsiteAudienceCriterion, WebsitePeriodEvidence> = Object.fromEntries(([
  "visitors", "url", "event",
] as WebsiteAudienceCriterion[]).map((criterion) => [criterion, { sourceId: undefined, criterion, initialDays: null, editable: "unknown", metaMinimumDays: null, metaMaximumDays: null, localValidationMaximumDays: null, unit: "days", historicalFill: "unknown", observedAt: "2026-09-09", context: "Contrato local do ticket 05; a divergência entre a UI do Gerenciador e os exemplos da API não foi fechada em execução headless.", source: "NOTES do ticket 05 e contrato compilado de regras de público do site" } satisfies WebsitePeriodEvidence])) as Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>;
export function websitePeriodEvidenceFor(sourceId: string, criterion: WebsiteAudienceCriterion): WebsitePeriodEvidence { return { ...WEBSITE_PERIOD_EVIDENCE[criterion], sourceId }; }
export function websitePeriodEvidenceBySource(sourceIds: ReadonlyArray<string>): Record<string, Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>> { return Object.fromEntries(sourceIds.map((sourceId) => [sourceId, Object.fromEntries((Object.keys(WEBSITE_PERIOD_EVIDENCE) as WebsiteAudienceCriterion[]).map((criterion) => [criterion, websitePeriodEvidenceFor(sourceId, criterion)])) as Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>])) as Record<string, Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>>; }
export function websitePeriodEvidenceStatus(criterion: WebsiteAudienceCriterion, evidence = WEBSITE_PERIOD_EVIDENCE[criterion]): "ready" | "blocked" { return evidence.initialDays !== null && evidence.editable !== "unknown" && evidence.metaMinimumDays !== null && evidence.metaMaximumDays !== null && evidence.historicalFill !== "unknown" ? "ready" : "blocked"; }
const DAY = 86_400;
export function validateWebsiteAudienceSelection(selection: WebsiteAudienceSelection): void {
  if (!selection.pixelId.trim() || !Number.isSafeInteger(selection.retentionDays) || selection.retentionDays < 1) throw new Error("O período do público do site deve ser um número inteiro positivo de dias e precisa ser confirmado pela Meta.");
  if (selection.criterion === "url" && !selection.url?.trim()) throw new Error("Informe a URL do filtro do público do site.");
  if (selection.criterion === "event" && !selection.event?.trim()) throw new Error("Informe um evento observado neste Pixel.");
}
export function buildWebsiteAudienceRule(selection: WebsiteAudienceSelection) {
  validateWebsiteAudienceSelection(selection);
  const filter = selection.criterion === "url" ? { field: "url", operator: "i_contains", value: selection.url!.trim() } : { field: "event", operator: "eq", value: selection.criterion === "event" ? selection.event!.trim() : "PageView" };
  return { inclusions: { operator: "or" as const, rules: [{ event_sources: [{ id: selection.pixelId.trim(), type: "pixel" as const }], retention_seconds: selection.retentionDays * DAY, filter: { operator: "and" as const, filters: [filter] } }] } };
}
export const websiteAudienceRuleInput = buildWebsiteAudienceRule;
export function parseWebsiteAudienceRule(rule: unknown): WebsiteAudienceSelection | null {
  if (!rule || typeof rule !== "object") return null;
  const root = rule as { inclusions?: unknown; exclusions?: unknown };
  if (Object.keys(rule).some((key) => key !== "inclusions") || root.exclusions !== undefined) return null;
  const inclusions = root.inclusions as { operator?: unknown; rules?: unknown[] } | undefined;
  if (!inclusions || Object.keys(inclusions).some((key) => !["operator", "rules"].includes(key)) || inclusions.operator !== "or" || !Array.isArray(inclusions.rules) || inclusions.rules.length !== 1) return null;
  const item = inclusions.rules[0];
  if (!item || typeof item !== "object") return null;
  const simple = item as { event_sources?: unknown; retention_seconds?: unknown; filter?: unknown };
  if (Object.keys(item).some((key) => !["event_sources", "retention_seconds", "filter"].includes(key))) return null;
  const sources = simple.event_sources as Array<{ id?: unknown; type?: unknown }> | undefined;
  if (!sources || sources.length !== 1 || Object.keys(sources[0] ?? {}).some((key) => !["id", "type"].includes(key)) || sources[0]?.type !== "pixel" || typeof sources[0]?.id !== "string") return null;
  const filterGroup = simple.filter as { operator?: unknown; filters?: unknown[] } | undefined;
  if (!filterGroup || typeof filterGroup !== "object" || Object.keys(filterGroup).some((key) => !["operator", "filters"].includes(key)) || filterGroup.operator !== "and" || filterGroup.filters?.length !== 1) return null;
  const filter = filterGroup.filters[0] as { field?: unknown; operator?: unknown; value?: unknown } | undefined;
  if (!filter || Object.keys(filter).some((key) => !["field", "operator", "value"].includes(key)) || typeof filter.value !== "string") return null;
  const seconds = simple.retention_seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds % DAY !== 0) return null;
  const retentionDays = seconds / DAY;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) return null;
  if (filter.field === "event" && filter.operator === "eq") return { pixelId: sources[0].id, criterion: filter.value === "PageView" ? "visitors" : "event", ...(filter.value === "PageView" ? {} : { event: filter.value }), retentionDays };
  if (filter.field === "url" && filter.operator === "i_contains" && filter.value === filter.value.trim() && filter.value) return { pixelId: sources[0].id, criterion: "url", url: filter.value, retentionDays };
  return null;
}
export function websiteSelectionsEqual(left: WebsiteAudienceSelection | null | undefined, right: WebsiteAudienceSelection): boolean { if (!left || left.pixelId.trim() !== right.pixelId.trim() || left.criterion !== right.criterion || left.retentionDays !== right.retentionDays) return false; if (right.criterion === "url") return left.url?.trim() === right.url?.trim(); if (right.criterion === "event") return left.event?.trim() === right.event?.trim(); return true; }
