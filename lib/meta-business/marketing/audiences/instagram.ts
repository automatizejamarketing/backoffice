import { compileAudienceRule, type AudienceRuleInput, type CompiledAudienceRule } from "./rule";

export const INSTAGRAM_AUDIENCE_CRITERIA = {
  all: "ig_business_profile_all",
  engaged: "ig_business_profile_engaged",
  profile_visit: "ig_business_profile_visit",
  messaged: "ig_user_messaged_business",
  saved: "ig_business_profile_ad_saved",
} as const;

export type InstagramAudienceCriterion = keyof typeof INSTAGRAM_AUDIENCE_CRITERIA;
export type InstagramAudienceSelection = { profileId: string; criterion: InstagramAudienceCriterion; retentionDays: number };
export type InstagramSourceEvidence = { access: "available" | "unavailable" | "unknown"; activity: "available" | "unavailable" | "unknown"; availability: "available" | "unavailable" | "unknown"; guidance: string };
export function resolveInstagramSourceEvidence(profiles: ReadonlyArray<{ id: string }>, profileId: string): InstagramSourceEvidence {
  if (!profiles.some((profile) => profile.id === profileId)) return { access: "unavailable", activity: "unknown", availability: "unavailable", guidance: "O perfil profissional escolhido não está acessível para esta conta. Conecte ou reautorize o ativo existente; esta tela não cria ativos nem instala rastreamento." };
  return { access: "available", activity: "unknown", availability: "unknown", guidance: "A fonte está acessível. A atividade do perfil e a disponibilidade final do público são decisões separadas da Meta e permanecem não confirmadas sem uma leitura autenticada do Gerenciador." };
}
export type InstagramPeriodEvidence = {
  profileId?: string;
  criterion: InstagramAudienceCriterion;
  initialDays: number | null;
  editable: "yes" | "no" | "unknown";
  metaMinimumDays: number | null;
  metaMaximumDays: number | null;
  localValidationMaximumDays: number;
  unit: "days";
  historicalFill: "available" | "unavailable" | "unknown";
  observedAt: string;
  context: string;
  source: string;
};

/** No default is safe here: the initial period is a per-profile/criterion Ads Manager value. */
export const INSTAGRAM_PERIOD_EVIDENCE: Record<InstagramAudienceCriterion, InstagramPeriodEvidence> =
  Object.fromEntries((Object.keys(INSTAGRAM_AUDIENCE_CRITERIA) as InstagramAudienceCriterion[]).map((criterion) => [criterion, {
    criterion,
    initialDays: null,
    editable: "unknown",
    metaMinimumDays: null,
    metaMaximumDays: null,
    localValidationMaximumDays: 730,
    unit: "days",
    historicalFill: "unknown",
    observedAt: "2026-09-10",
    context: "V02: a confirmação v25 pelo Gerenciador não está disponível em execução headless; a interface e a API não foram equiparadas por inferência.",
    source: "Documentação oficial Meta v25 de públicos de engajamento; sem observação autenticada da interface do Gerenciador.",
  } satisfies InstagramPeriodEvidence])) as Record<InstagramAudienceCriterion, InstagramPeriodEvidence>;

export function instagramPeriodEvidenceStatus(criterion: InstagramAudienceCriterion, evidence = INSTAGRAM_PERIOD_EVIDENCE[criterion]): "ready" | "blocked" {
  return evidence.initialDays !== null && evidence.editable !== "unknown" && evidence.metaMinimumDays !== null && evidence.metaMaximumDays !== null && evidence.historicalFill !== "unknown" ? "ready" : "blocked";
}

export function instagramPeriodEvidenceFor(profileId: string, criterion: InstagramAudienceCriterion): InstagramPeriodEvidence {
  return { ...INSTAGRAM_PERIOD_EVIDENCE[criterion], profileId };
}

export function instagramPeriodEvidenceByProfile(profileIds: ReadonlyArray<string>): Record<string, Record<InstagramAudienceCriterion, InstagramPeriodEvidence>> {
  return Object.fromEntries(profileIds.map((profileId) => [profileId, Object.fromEntries((Object.keys(INSTAGRAM_AUDIENCE_CRITERIA) as InstagramAudienceCriterion[]).map((criterion) => [criterion, instagramPeriodEvidenceFor(profileId, criterion)])) as Record<InstagramAudienceCriterion, InstagramPeriodEvidence>])) as Record<string, Record<InstagramAudienceCriterion, InstagramPeriodEvidence>>;
}

const DAY = 86_400;

export function validateInstagramAudienceSelection(selection: InstagramAudienceSelection): void {
  if (!selection.profileId.trim() || !Number.isInteger(selection.retentionDays) || selection.retentionDays < 1 || selection.retentionDays > 730) {
    throw new Error("Informe o período inteiro mostrado pelo Gerenciador (entre 1 e 730 dias; sem valor padrão).");
  }
}

export function instagramAudienceRuleInput(selection: InstagramAudienceSelection): AudienceRuleInput {
  validateInstagramAudienceSelection(selection);
  return { inclusions: [{ eventSources: [{ id: selection.profileId, type: "ig_business" }], retentionDays: selection.retentionDays, filters: [{ field: "event", operator: "eq", value: INSTAGRAM_AUDIENCE_CRITERIA[selection.criterion] }] }] };
}

export function buildInstagramAudienceRule(selection: InstagramAudienceSelection): CompiledAudienceRule {
  const compiled = compileAudienceRule(instagramAudienceRuleInput(selection));
  if (!compiled.ok) throw new Error("Invalid Instagram audience selection");
  return compiled.rule;
}

export function parseInstagramAudienceRule(raw: unknown): InstagramAudienceSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as { inclusions?: unknown; exclusions?: unknown };
  if (Object.keys(rule).some((key) => key !== "inclusions") || rule.exclusions !== undefined) return null;
  const inclusions = rule.inclusions;
  if (!inclusions || typeof inclusions !== "object") return null;
  const inclusionObject = inclusions as { operator?: unknown; rules?: unknown };
  if (Object.keys(inclusionObject).some((key) => !["operator", "rules"].includes(key)) || inclusionObject.operator !== "or" || !Array.isArray(inclusionObject.rules) || inclusionObject.rules.length !== 1) return null;
  const item = inclusionObject.rules[0];
  if (!item || typeof item !== "object") return null;
  const itemObject = item as { event_sources?: unknown; retention_seconds?: unknown; filter?: unknown };
  if (Object.keys(itemObject).some((key) => !["event_sources", "retention_seconds", "filter"].includes(key)) || !Array.isArray(itemObject.event_sources) || itemObject.event_sources.length !== 1) return null;
  const source = itemObject.event_sources[0];
  if (!source || typeof source !== "object") return null;
  const sourceObject = source as { id?: unknown; type?: unknown };
  if (Object.keys(sourceObject).some((key) => !["id", "type"].includes(key)) || sourceObject.type !== "ig_business" || typeof sourceObject.id !== "string") return null;
  const filterGroup = itemObject.filter;
  if (!filterGroup || typeof filterGroup !== "object") return null;
  const filterObject = filterGroup as { operator?: unknown; filters?: unknown };
  if (Object.keys(filterObject).some((key) => !["operator", "filters"].includes(key)) || filterObject.operator !== "and" || !Array.isArray(filterObject.filters) || filterObject.filters.length !== 1) return null;
  const filter = filterObject.filters[0];
  if (!filter || typeof filter !== "object") return null;
  const filterValue = filter as { field?: unknown; operator?: unknown; value?: unknown };
  if (Object.keys(filterValue).some((key) => !["field", "operator", "value"].includes(key)) || filterValue.field !== "event" || filterValue.operator !== "eq" || typeof filterValue.value !== "string") return null;
  const criterion = (Object.entries(INSTAGRAM_AUDIENCE_CRITERIA) as Array<[InstagramAudienceCriterion, string]>).find(([, value]) => value === filterValue.value)?.[0];
  const seconds = itemObject.retention_seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds % DAY !== 0 || !criterion) return null;
  const retentionDays = seconds / DAY;
  return retentionDays >= 1 && retentionDays <= 730 ? { profileId: source.id, criterion, retentionDays } : null;
}
