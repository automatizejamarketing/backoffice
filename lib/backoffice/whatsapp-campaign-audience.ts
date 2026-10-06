import { z } from "zod";
import { shiftCalendarDate } from "@/lib/backoffice/dashboard-date-range";
import type { DateCondition } from "@/lib/dates";

export const AUDIENCE_STATUSES = {
  never_started: "Nunca iniciou trial", trial_active: "Trial ativo", trial_expired: "Trial expirado",
  churn: "Churn · já pagou e expirou", paying: "Assinante ativo", other: "Outras contas",
} as const;
export type AudienceStatus = keyof typeof AUDIENCE_STATUSES;
const day = z.union([z.literal(''), z.string().date()]);
export const audienceFiltersSchema = z.object({
  statuses: z.array(z.enum(['never_started','trial_active','trial_expired','churn','paying','other'])).min(1).max(6).default(['never_started']),
  createdFrom: day.default(''), createdTo: day.default(''), expiresFrom: day.default(''), expiresTo: day.default(''),
  excludeContacted: z.boolean().default(true),
}).refine(v => (!v.createdFrom || !v.createdTo || v.createdFrom <= v.createdTo) && (!v.expiresFrom || !v.expiresTo || v.expiresFrom <= v.expiresTo), 'A data inicial deve ser anterior à final.');
export type AudienceFilters = z.infer<typeof audienceFiltersSchema>;
export const DEFAULT_AUDIENCE_FILTERS = audienceFiltersSchema.parse({});
export function templateRejectionReason(status: string | undefined, reason: string | undefined): string | null {
  const text = reason?.trim();
  return status === 'REJECTED' && text && !['NONE','NULL','N/A'].includes(text.toUpperCase()) ? text : null;
}
export function readRate(read: number, delivered: number): number | null {
  return delivered > 0 ? Math.min(100, read / delivered * 100) : null;
}
/** Filtros salvos guardam limites inclusivos; o filtro de data da tela fala em operadores. "Antes de" e "Depois de" não incluem o próprio dia. */
export function audienceDateCondition(from: string, to: string): DateCondition | undefined {
  if (from && to) return from === to ? { op: 'on', date: from } : { op: 'between', from, to };
  if (from) return { op: 'after', date: shiftCalendarDate(from, -1) };
  if (to) return { op: 'before', date: shiftCalendarDate(to, 1) };
  return undefined;
}
export function audienceDateBounds(condition: DateCondition | undefined): { from: string; to: string } {
  if (!condition) return { from: '', to: '' };
  if (condition.op === 'between') return { from: condition.from, to: condition.to };
  if (condition.op === 'on') return { from: condition.date, to: condition.date };
  return condition.op === 'after' ? { from: shiftCalendarDate(condition.date, 1), to: '' } : { from: '', to: shiftCalendarDate(condition.date, -1) };
}
