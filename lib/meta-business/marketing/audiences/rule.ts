import { type CreateIssue, localIssue } from "../creation/types";

const DAY = 86_400;

export type AudienceRuleFilter = { field: string; operator: string; value: string };
export type AudienceRuleIntent = {
  eventSources: Array<{ id: string; type: string }>;
  retentionDays: number;
  filters: AudienceRuleFilter[];
  filterOperator?: "and" | "or";
  aggregation?: Record<string, unknown>;
};
export type AudienceRuleInput = { inclusions: AudienceRuleIntent[]; inclusionOperator?: "and" | "or"; exclusions?: AudienceRuleIntent[]; exclusionOperator?: "and" | "or" };
type CompiledRule = { event_sources: Array<{ id: string; type: string }>; retention_seconds: number; filter: { operator: "and" | "or"; filters: AudienceRuleFilter[] }; aggregation?: Record<string, unknown> };
export type CompiledAudienceRule = { inclusions: { operator: "and" | "or"; rules: CompiledRule[] }; exclusions?: { operator: "and" | "or"; rules: CompiledRule[] } };

export function validateAudienceRule(input: AudienceRuleInput): CreateIssue[] {
  const issues: CreateIssue[] = [];
  const allRules = [...(input.inclusions ?? []), ...(input.exclusions ?? [])];
  if (!input.inclusions?.length) issues.push(localIssue("audience", "INCLUSIONS_REQUIRED", "A regra precisa de ao menos uma inclusão.", "Informe a fonte e o evento que entram no público."));
  if (allRules.length > 10) issues.push(localIssue("audience", "TOO_MANY_RULES", "A regra excede o limite local de dez regras.", "Reduza as regras antes de confirmar."));
  for (const [index, rule] of allRules.entries()) {
    if (!rule.eventSources?.length) issues.push(localIssue("audience", "EVENT_SOURCE_REQUIRED", `Regra ${index}: falta a fonte de evento.`, "Informe a fonte profissional do Instagram."));
    if (!rule.filters?.length) issues.push(localIssue("audience", "FILTERS_REQUIRED", `Regra ${index}: falta o filtro.`, "Informe um critério de evento."));
    if (!Number.isInteger(rule.retentionDays) || rule.retentionDays < 1 || rule.retentionDays > 730) issues.push(localIssue("audience", "RETENTION_OUT_OF_RANGE", `Regra ${index}: período inválido.`, "Informe o período real entre 1 e 730 dias."));
    for (const [filterIndex, filter] of (rule.filters ?? []).entries()) if (filter.field === "event" && !["eq", "="].includes(filter.operator)) issues.push(localIssue("audience", "EVENT_OPERATOR_MUST_EQ", `Regra ${index}, filtro ${filterIndex}: evento precisa usar eq.`, "Use o critério retornado pelo editor."));
  }
  return issues;
}

function compileRule(rule: AudienceRuleIntent): CompiledRule {
  return { event_sources: rule.eventSources.map((source) => ({ ...source })), retention_seconds: Math.round(rule.retentionDays * DAY), filter: { operator: rule.filterOperator ?? "and", filters: rule.filters.map((filter) => ({ ...filter })) }, ...(rule.aggregation ? { aggregation: rule.aggregation } : {}) };
}

export function compileAudienceRule(input: AudienceRuleInput): { ok: true; rule: CompiledAudienceRule } | { ok: false; issues: CreateIssue[] } {
  const issues = validateAudienceRule(input);
  if (issues.length) return { ok: false, issues };
  return { ok: true, rule: { inclusions: { operator: input.inclusionOperator ?? "or", rules: input.inclusions.map(compileRule) }, ...(input.exclusions?.length ? { exclusions: { operator: input.exclusionOperator ?? "or", rules: input.exclusions.map(compileRule) } } : {}) } };
}
