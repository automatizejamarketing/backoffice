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
    observedAt: "2026-09-09",
    context: "Contrato local do ticket 04; a confirmação v25 pelo Gerenciador não está disponível em execução headless.",
    source: "NOTES do ticket 04 e contrato compilado de regras de audiência",
  } satisfies InstagramPeriodEvidence])) as Record<InstagramAudienceCriterion, InstagramPeriodEvidence>;

export function instagramPeriodEvidenceStatus(criterion: InstagramAudienceCriterion): "ready" | "blocked" {
  const evidence = INSTAGRAM_PERIOD_EVIDENCE[criterion];
  return evidence.initialDays !== null && evidence.editable !== "unknown" && evidence.metaMinimumDays !== null && evidence.metaMaximumDays !== null && evidence.historicalFill !== "unknown" ? "ready" : "blocked";
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
  const rule = raw as { inclusions?: { operator?: unknown; rules?: unknown[] }; exclusions?: unknown };
  const item = rule.inclusions?.operator === "or" && rule.inclusions.rules?.length === 1 ? rule.inclusions.rules[0] as { event_sources?: Array<{ id?: unknown; type?: unknown }>; retention_seconds?: unknown; filter?: { operator?: unknown; filters?: Array<{ field?: unknown; operator?: unknown; value?: unknown }> } } : null;
  const source = item?.event_sources?.length === 1 ? item.event_sources[0] : null;
  const filter = item?.filter?.operator === "and" && item.filter.filters?.length === 1 ? item.filter.filters[0] : null;
  const criterion = filter?.field === "event" && filter.operator === "eq" && typeof filter.value === "string" ? (Object.entries(INSTAGRAM_AUDIENCE_CRITERIA) as Array<[InstagramAudienceCriterion, string]>).find(([, value]) => value === filter.value)?.[0] : undefined;
  const seconds = item?.retention_seconds;
  if (rule.exclusions !== undefined || (item && Object.keys(item).some((key) => !["event_sources", "retention_seconds", "filter"].includes(key))) || (item?.filter && Object.keys(item.filter).some((key) => !["operator", "filters"].includes(key))) || (filter && Object.keys(filter).some((key) => !["field", "operator", "value"].includes(key))) || source?.type !== "ig_business" || typeof source.id !== "string" || typeof seconds !== "number" || !Number.isInteger(seconds) || seconds % DAY !== 0 || !criterion) return null;
  const retentionDays = seconds / DAY;
  return retentionDays >= 1 && retentionDays <= 730 ? { profileId: source.id, criterion, retentionDays } : null;
}
