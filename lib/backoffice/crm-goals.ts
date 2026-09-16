import type { StatusTone } from "@/components/ui/status-badge";
import type { SalesRole } from "@/lib/auth/rbac-core";
import { CRM_STATUS_META, type CrmCommercialStatus } from "@/lib/backoffice/crm";
import { escapeCsvCell } from "@/lib/backoffice/users-csv";

/**
 * Metas do time comercial. Vocabulário em CONTEXT.md, seção "CRM comercial".
 *
 * Cada métrica é uma taxa (numerador ÷ denominador) calculada por mês
 * calendário (BRT) no modo "fluxo do período": conta o que aconteceu dentro
 * do mês, sem exigir que numerador e denominador sejam o mesmo grupo de leads.
 * O modo "coorte" (das contas criadas no mês, quantas converteram) ficou
 * anotado como alternativa — ver docs/crm-metas.md.
 */

export const CRM_METRIC_VALUES = [
  "agendamento",
  "conversao_trial",
  "conversao_real",
] as const;

export type CrmMetric = (typeof CRM_METRIC_VALUES)[number];

export function isCrmMetric(value: unknown): value is CrmMetric {
  return CRM_METRIC_VALUES.includes(value as CrmMetric);
}

/** Cargo comercial: rótulo de quem responde por cada meta. Separado do papel de acesso. */
export { SALES_ROLE_VALUES, isSalesRole, type SalesRole } from "@/lib/auth/rbac-core";

export const SALES_ROLE_LABELS: Record<SalesRole, string> = {
  gestor_comercial: "Gestor comercial",
  sdr: "SDR",
  consultor_comercial: "Consultor comercial",
};

export const CRM_METRIC_META: Record<
  CrmMetric,
  {
    label: string;
    /** Cargo que responde pela métrica. */
    owner: SalesRole;
    /** Como ler "X de Y" no card. */
    numeratorLabel: string;
    denominatorLabel: string;
    description: string;
    /** Meta inicial combinada com o gestor; null = sem meta (só o número). */
    defaultTarget: number | null;
  }
> = {
  agendamento: {
    label: "Taxa de agendamento",
    owner: "sdr",
    numeratorLabel: "agendamentos",
    denominatorLabel: "leads qualificáveis criados",
    description:
      "Leads que entraram em Reunião agendada (ou estágio posterior) no mês, sobre contas criadas no mês com telefone e fora da equipe.",
    defaultTarget: 60,
  },
  conversao_trial: {
    label: "Conversão em trial",
    owner: "consultor_comercial",
    numeratorLabel: "viraram trial",
    denominatorLabel: "reuniões realizadas",
    description:
      "Reuniões realizadas no mês cuja conta iniciou acesso (assinatura ou trial), em qualquer data, sobre reuniões realizadas no mês.",
    defaultTarget: 75,
  },
  conversao_real: {
    label: "Conversão real",
    owner: "consultor_comercial",
    numeratorLabel: "viraram clientes",
    denominatorLabel: "reuniões realizadas",
    description:
      "Reuniões realizadas no mês cuja conta teve pagamento de assinatura aprovado, em qualquer data. O pagamento vem depois do trial, então a taxa fecha semanas depois.",
    defaultTarget: null,
  },
};

/**
 * Reunião realizada que virou trial / cliente. Olha só se a conta tem
 * assinatura (trial ou paga) e pagamento aprovado, em qualquer data: o
 * status do kanban é marcado depois do fato, muitas vezes em lote, então
 * exigir assinatura posterior ao status zerava as duas conversões.
 */
export function crmMeetingOutcome(input: {
  subscribedAt: Date | null;
  paidAt: Date | null;
}): { trial: boolean; customer: boolean } {
  return { trial: input.subscribedAt !== null, customer: input.paidAt !== null };
}

/** Distância (em pontos percentuais) abaixo da meta que ainda conta como "perto". */
export const CRM_GOAL_NEAR_POINTS = 10;

export type CrmGoalStatus = "on" | "near" | "off" | "neutral";

/**
 * Semáforo: verde ≥ meta, laranja até CRM_GOAL_NEAR_POINTS abaixo, vermelho
 * além. Sem meta ou sem volume não há o que julgar.
 */
export function crmGoalStatus(input: {
  rate: number | null;
  target: number | null;
}): CrmGoalStatus {
  if (input.rate === null || input.target === null) return "neutral";
  if (input.rate >= input.target) return "on";
  if (input.rate >= input.target - CRM_GOAL_NEAR_POINTS) return "near";
  return "off";
}

export const CRM_GOAL_STATUS_META: Record<
  CrmGoalStatus,
  { label: string; tone: StatusTone }
> = {
  on: { label: "Na meta", tone: "success" },
  near: { label: "Perto da meta", tone: "orange" },
  off: { label: "Longe da meta", tone: "danger" },
  neutral: { label: "Sem meta", tone: "neutral" },
};

/** Taxa em pontos percentuais (0–100), com uma casa; null quando não há volume. */
export function crmRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ---------- Mês calendário ----------

/** "YYYY-MM" válido. */
export function isCrmMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

/** Mês calendário BRT de um instante. */
export function crmMonthOf(date: Date): string {
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 7);
}

export function shiftCrmMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

/** Primeiro dia do mês e do mês seguinte, como datas de calendário (YYYY-MM-DD). */
export function crmMonthCalendarBounds(month: string): { from: string; toExclusive: string } {
  return { from: `${month}-01`, toExclusive: `${shiftCrmMonth(month, 1)}-01` };
}

export function formatCrmMonth(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ---------- Metas guardadas por mês, herdando o mês anterior ----------

export type CrmGoalRow = {
  month: string;
  metric: CrmMetric;
  /** null = o gestor decidiu que a métrica não tem meta a partir deste mês. */
  target: number | null;
};

export type ResolvedCrmGoal = {
  metric: CrmMetric;
  target: number | null;
  /** Mês de onde veio o valor; null quando é o padrão em código. */
  sourceMonth: string | null;
  inherited: boolean;
};

/**
 * A meta de um mês é a linha mais recente com `month <= mês`. Sem linha,
 * vale o padrão em código. Guardar uma linha só quando o gestor muda algo
 * evita obrigar alguém a preencher todo mês.
 */
export function resolveCrmGoals(
  month: string,
  rows: CrmGoalRow[],
): Record<CrmMetric, ResolvedCrmGoal> {
  const resolved = {} as Record<CrmMetric, ResolvedCrmGoal>;
  for (const metric of CRM_METRIC_VALUES) {
    const candidates = rows
      .filter((row) => row.metric === metric && row.month <= month)
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
    const latest = candidates[0];
    resolved[metric] = latest
      ? {
          metric,
          target: latest.target,
          sourceMonth: latest.month,
          inherited: latest.month !== month,
        }
      : {
          metric,
          target: CRM_METRIC_META[metric].defaultTarget,
          sourceMonth: null,
          inherited: true,
        };
  }
  return resolved;
}

/** Só o mês corrente e os futuros aceitam edição: mês fechado não se reescreve. */
export function canEditCrmGoalMonth(month: string, now: Date = new Date()): boolean {
  return month >= crmMonthOf(now);
}

/** Percentual inteiro entre 0 e 100, ou null para "sem meta". */
export function parseCrmGoalTarget(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return value;
}

// ---------- Contas da equipe ----------

/** Domínios da equipe; contas com esses emails não são leads. */
export const INTERNAL_LEAD_DOMAINS = ["infinitegrowth.com.br", "layback.trade"] as const;

/** Gmails da equipe que não têm conta no backoffice. */
export const INTERNAL_LEAD_EMAILS = [
  "joaopedrocorrea14@gmail.com",
  "automatizejamarketing@gmail.com",
] as const;

/** Email sem o `+alias` e em minúsculas, para comparar contas de teste. */
export function baseEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return normalized;
  return `${normalized.slice(0, at).split("+")[0]}${normalized.slice(at)}`;
}

export function isInternalLeadEmail(
  email: string,
  teamEmails: Iterable<string>,
): boolean {
  const base = baseEmail(email);
  const domain = base.slice(base.lastIndexOf("@") + 1);
  if ((INTERNAL_LEAD_DOMAINS as readonly string[]).includes(domain)) return true;
  if ((INTERNAL_LEAD_EMAILS as readonly string[]).includes(base)) return true;
  for (const teamEmail of teamEmails) {
    if (baseEmail(teamEmail) === base) return true;
  }
  return false;
}

// ---------- Estágios do funil que contam ----------

/** Entrar em qualquer um destes é "agendou" (pular etapa pressupõe agendamento). */
export const SCHEDULED_OR_LATER_STATUSES = [
  "reuniao_agendada",
  "no_show",
  "reuniao_realizada",
  "trial_feito",
] as const;

/** Entrar em qualquer um destes é "reunião realizada". */
export const MEETING_DONE_STATUSES = ["reuniao_realizada", "trial_feito"] as const;

// ---------- Exportação dos leads de uma métrica ----------

export type CrmGoalLeadCsvRow = {
  name: string | null;
  companyName: string | null;
  email: string;
  phone: string | null;
  commercialStatus: CrmCommercialStatus;
  createdAt: string | null;
  eventAt: string | null;
  inDenominator: boolean;
  inNumerator: boolean;
};

function csvDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date(iso))
    // "05/09/2026, 10:00" → sem a vírgula, para não precisar de aspas na célula.
    .replace(", ", " ");
}

/** CSV (UTF-8 com BOM, CRLF) dos leads por trás de uma métrica, para o Excel. */
export function buildCrmGoalLeadsCsv(metric: CrmMetric, rows: CrmGoalLeadCsvRow[]): string {
  const meta = CRM_METRIC_META[metric];
  const eventLabel = metric === "agendamento" ? "Agendou em" : "Reunião em";
  const countedLabel =
    metric === "agendamento" ? "Agendou" : metric === "conversao_trial" ? "Virou trial" : "Virou cliente";
  const header = [
    "Nome",
    "Empresa",
    "E-mail",
    "Telefone",
    "Status comercial",
    "Cadastro",
    eventLabel,
    countedLabel,
    `Na base (${meta.denominatorLabel})`,
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      row.companyName,
      row.email,
      row.phone,
      CRM_STATUS_META[row.commercialStatus].label,
      csvDate(row.createdAt),
      csvDate(row.eventAt),
      row.inNumerator ? "Sim" : "Não",
      row.inDenominator ? "Sim" : "Não",
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return `\uFEFF${[header.map(escapeCsvCell).join(","), ...lines].join("\r\n")}`;
}

export function crmGoalLeadsCsvFilename(metric: CrmMetric, month: string): string {
  return `metas-${metric}-${month}.csv`;
}
