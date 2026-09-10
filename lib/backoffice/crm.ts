import type { StatusTone } from "@/components/ui/status-badge";
import {
  CRM_COMMERCIAL_STATUS_VALUES,
  type CrmCommercialStatus,
} from "@/lib/db/schema";

export { CRM_COMMERCIAL_STATUS_VALUES, type CrmCommercialStatus };

/** Funil comercial, na ordem das colunas do kanban. */
export const CRM_STATUS_META: Record<
  CrmCommercialStatus,
  { label: string; description: string; tone: StatusTone }
> = {
  novo_lead: {
    label: "Novo lead",
    description: "Acabou de criar a conta e ninguém falou com ele ainda.",
    tone: "neutral",
  },
  em_qualificacao: {
    label: "Em qualificação",
    description: "Alguém do comercial está em contato.",
    tone: "warning",
  },
  reuniao_agendada: {
    label: "Reunião agendada",
    description: "Tem dia e hora marcados.",
    tone: "warning",
  },
  reuniao_realizada: {
    label: "Reunião realizada",
    description: "A reunião aconteceu.",
    tone: "success",
  },
  trial_feito: {
    label: "Trial feito",
    description: "Ativou o trial depois do contato.",
    tone: "success",
  },
  no_show: {
    label: "No show",
    description: "Marcou e não apareceu.",
    tone: "danger",
  },
  follow_up: {
    label: "Follow up",
    description: "Combinado retomar o contato mais tarde.",
    tone: "warning",
  },
};

export function isCrmCommercialStatus(value: unknown): value is CrmCommercialStatus {
  return CRM_COMMERCIAL_STATUS_VALUES.includes(value as CrmCommercialStatus);
}

/**
 * Estágio da conta, que é nosso e não do comercial: derivado só de
 * `users.expiration_date` e de existir pagamento aprovado.
 */
export const CRM_ACCOUNT_STAGE_VALUES = [
  "sem_trial",
  "trial_ativo",
  "trial_vencido",
  "assinante_ativo",
  "assinante_vencido",
] as const;

export type CrmAccountStage = (typeof CRM_ACCOUNT_STAGE_VALUES)[number];

export const CRM_ACCOUNT_STAGE_META: Record<
  CrmAccountStage,
  { label: string; tone: StatusTone }
> = {
  sem_trial: { label: "Sem trial", tone: "neutral" },
  trial_ativo: { label: "Em trial", tone: "warning" },
  trial_vencido: { label: "Trial vencido", tone: "danger" },
  assinante_ativo: { label: "Assinante", tone: "success" },
  assinante_vencido: { label: "Assinatura vencida", tone: "danger" },
};

export function isCrmAccountStage(value: unknown): value is CrmAccountStage {
  return CRM_ACCOUNT_STAGE_VALUES.includes(value as CrmAccountStage);
}

export function deriveAccountStage(
  input: {
    expirationDate: Date | string | null | undefined;
    hasApprovedPayment: boolean;
  },
  now: Date = new Date(),
): CrmAccountStage {
  if (!input.expirationDate) return "sem_trial";
  const expiresAt = new Date(input.expirationDate);
  const active = expiresAt.getTime() > now.getTime();
  if (input.hasApprovedPayment) {
    return active ? "assinante_ativo" : "assinante_vencido";
  }
  return active ? "trial_ativo" : "trial_vencido";
}

export const CRM_NOTE_MAX_LENGTH = 4_000;

export function normalizeCrmNote(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > CRM_NOTE_MAX_LENGTH) return null;
  return trimmed;
}

/** Linha do CRM: um usuário com o que o comercial precisa ver de relance. */
export type CrmLeadSummary = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  companyName: string | null;
  consultantName: string | null;
  createdAt: string | null;
  expirationDate: string | null;
  hasApprovedPayment: boolean;
  accountStage: CrmAccountStage;
  commercialStatus: CrmCommercialStatus;
  /** Quando entrou no status atual; para "novo lead" sem linha, a data do cadastro. */
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  productTitles: string[];
  lastNote: { body: string; createdAt: string; authorEmail: string } | null;
};

export type CrmLeadEventView = {
  id: string;
  kind: "note" | "status";
  body: string | null;
  statusFrom: CrmCommercialStatus | null;
  statusTo: CrmCommercialStatus | null;
  authorEmail: string;
  createdAt: string;
};

export type CrmKanbanColumn = {
  status: CrmCommercialStatus;
  total: number;
  leads: CrmLeadSummary[];
};

export function displayLeadName(lead: Pick<CrmLeadSummary, "name" | "companyName" | "email">) {
  return lead.name?.trim() || lead.companyName?.trim() || lead.email;
}
