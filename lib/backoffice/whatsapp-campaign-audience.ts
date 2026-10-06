import { z } from "zod";

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
