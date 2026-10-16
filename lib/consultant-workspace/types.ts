/** Tipos da área de Tráfego do consultor (servidor e cliente). */

import type { AccessSegment } from "./access";

export type PlanTier = "premium" | "pro" | "starter" | "sem_plano";

export type GoalKpi = "cpa" | "cpl" | "custo_conversa" | "roas" | "custo_resultado";

export type WorkspaceGoal = {
  kpi: GoalKpi;
  /** Para custo: valor máximo em R$. Para ROAS: mínimo (ex.: 3 = 3x). */
  target: number;
  /** Verba mensal combinada com o cliente, em R$. */
  monthlyBudget: number | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type NoteKind = "nota" | "contato" | "reuniao" | "acao";

export type WorkspaceNote = {
  id: string;
  userId: string;
  kind: NoteKind;
  text: string;
  author: string;
  createdAt: string;
};

export type AlertOutcome =
  | "ajustei_campanha"
  | "pausei"
  | "escalei_verba"
  | "falei_com_cliente"
  | "sem_acao_necessaria"
  | "falso_alarme";

export const ALERT_OUTCOME_LABEL: Record<AlertOutcome, string> = {
  ajustei_campanha: "Ajustei a campanha",
  pausei: "Pausei",
  escalei_verba: "Aumentei a verba",
  falei_com_cliente: "Falei com o cliente",
  sem_acao_necessaria: "Sem ação necessária",
  falso_alarme: "Falso alarme",
};

export type WorkspaceAlertAction = {
  status: "done" | "dismissed" | "snoozed";
  outcome: AlertOutcome | null;
  note: string | null;
  snoozeUntil: string | null;
  by: string;
  at: string;
};

export type WorkspaceSimulatedAction = {
  id: string;
  userId: string;
  entityId: string;
  entityName: string | null;
  action: "pausar" | "ativar" | "orcamento" | "duplicar" | "trocar_criativo" | "otimizar";
  detail: string | null;
  note: string | null;
  by: string;
  at: string;
};

/** Id do consultor no backoffice (`backoffice_users.id`). */
export type ConsultantKey = string;

/** Passagem de bastão do onboarding (Fred) para o gestor de tráfego. */
export type WorkspaceHandoff = {
  summary: string;
  nextSteps: string;
  /** Data da call de onboarding (yyyy-mm-dd), opcional. */
  callDate: string | null;
  by: string;
  at: string;
};

/**
 * Tarefa do card no CRM: quem passou registra o que fez e o que o próximo
 * responsável deve fazer; o card vai para ele. Fica em `consultant_client_notes`
 * (kind `tarefa`; a conclusão é outra linha, kind `tarefa_ok`).
 */
export type WorkspaceTask = {
  id: string;
  userId: string;
  /** O que quem passou acabou de fazer. */
  done: string;
  /** O que o destinatário deve fazer. */
  todo: string;
  /** Responsável do CRM que recebeu (ver `crm.ts`). */
  to: string;
  by: string;
  at: string;
  closed: { by: string; at: string; note: string } | null;
};

export type WorkspaceSentMessage = {
  id: string;
  userId: string;
  templateKey: string;
  text: string;
  by: string;
  at: string;
  /** `mat`: a Mat mandou pelo WhatsApp da Automatize; `manual`: o gestor mandou do WhatsApp dele. */
  channel: "manual" | "mat";
};

export type WorkspaceAiAnalysis = {
  text: string;
  model: string;
  periodDays: number;
  generatedAt: string;
  by: string;
};

export type WorkspaceState = {
  goals: Record<string, WorkspaceGoal>;
  notes: WorkspaceNote[];
  alertActions: Record<string, WorkspaceAlertAction>;
  simulatedActions: WorkspaceSimulatedAction[];
  /** Não usado em produção: o responsável vem de `user_marketing_consultants`. */
  assignments: Record<string, ConsultantKey>;
  handoffs: Record<string, WorkspaceHandoff>;
  /** Tags de problema marcadas à mão (as automáticas vêm dos dados). */
  clientTags: Record<string, string[]>;
  /** Tags automáticas que alguém marcou como resolvidas/descartadas. */
  dismissedAutoTags: Record<string, string[]>;
  sentMessages: WorkspaceSentMessage[];
  aiAnalyses: Record<string, WorkspaceAiAnalysis>;
  /** Tarefas do CRM, mais recente primeiro. */
  tasks: WorkspaceTask[];
};

export type WorkspaceOp =
  | { op: "setGoal"; userId: string; goal: WorkspaceGoal }
  | { op: "clearGoal"; userId: string }
  | { op: "addNote"; userId: string; kind: NoteKind; text: string }
  | { op: "deleteNote"; noteId: string }
  | {
      op: "alertAction";
      insightIds: string[];
      userId?: string;
      status: WorkspaceAlertAction["status"];
      outcome?: AlertOutcome | null;
      note?: string | null;
      snoozeUntil?: string | null;
    }
  | { op: "clearAlertAction"; insightIds: string[] }
  | {
      op: "simulateMetaAction";
      userId: string;
      entityId: string;
      entityName: string | null;
      action: WorkspaceSimulatedAction["action"];
      detail?: string | null;
      note?: string | null;
    }
  | { op: "assign"; userId: string; consultant: ConsultantKey | null }
  /** Move o card no CRM para um responsável (arrastar, ou passar com tarefa). */
  | { op: "moveCard"; userId: string; to: string; done?: string; todo?: string }
  | { op: "completeTask"; userId: string; taskId: string; note?: string }
  | {
      op: "setHandoff";
      userId: string;
      summary: string;
      nextSteps: string;
      callDate?: string | null;
      tags: string[];
    }
  | { op: "setClientTags"; userId: string; tags: string[] }
  | { op: "dismissAutoTag"; userId: string; tag: string; dismissed: boolean }
  | { op: "sendMessage"; userId: string; templateKey: string; text: string }
  | { op: "saveAiAnalysis"; userId: string; analysis: Omit<WorkspaceAiAnalysis, "by" | "generatedAt"> }
  | { op: "reset" };

/** Totais de um período, somados das métricas diárias por campanha. */
export type PerfTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  results: number;
  purchases: number;
  purchaseValue: number;
  leads: number;
  conversations: number;
};

export type PrimaryKpi = {
  kind: "compras" | "leads" | "conversas" | "resultados";
  label: string;
  /** Rótulo do custo por resultado: "CPA", "CPL", "Custo/conversa", "Custo/resultado". */
  costLabel: string;
  count: number;
  cost: number | null;
  roas: number | null;
};

export type DailyPoint = { date: string; spend: number; results: number };

export type MetaHealth =
  | "ok"
  | "token_invalido"
  | "erro_checagem"
  | "checagem_velha"
  | "sem_meta";

export type WorkspaceAlert = {
  id: string;
  userId: string;
  ruleId: string;
  ruleTitle: string;
  family: "playbook" | "account";
  severity: "critical" | "warning" | "info";
  title: string;
  evidence: string;
  recommendation: string;
  entityLevel: string;
  entityId: string;
  entityName: string | null;
  actionType: string;
  metrics: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceClient = {
  userId: string;
  email: string;
  name: string | null;
  companyName: string | null;
  displayName: string;
  phone: string | null;
  plan: {
    tier: PlanTier;
    period: string | null;
    status: string | null;
    provider: string | null;
    renewalAt: string | null;
    /** Início da assinatura atual (no trial, quando o trial começou). */
    startedAt: string | null;
    /** Primeira assinatura do cliente: cliente desde. */
    customerSince: string | null;
  };
  accessUntil: string | null;
  /** Grupo de acesso (pagante, trial, cancelado com acesso…); ver `access.ts`. */
  access: AccessSegment;
  consultant: { key: ConsultantKey | null; name: string | null; email: string | null };
  meta: {
    health: MetaHealth;
    detail: string | null;
    accountName: string | null;
    hasActiveManagedCampaign: boolean;
    checkedAt: string | null;
  };
  publishHolds: number;
  perf: {
    current: PerfTotals;
    previous: PerfTotals;
    kpi: PrimaryKpi;
    previousKpi: PrimaryKpi;
    series: DailyPoint[];
    /** Gasto do mês corrente (1º do mês até ontem). */
    monthToDateSpend: number;
    activeCampaigns: number;
  };
  alerts: {
    open: number;
    critical: number;
    warning: number;
    info: number;
    oldestOpenAt: string | null;
  };
  lastConsultantTouchAt: string | null;
};

export type WorkspaceCampaign = {
  campaignId: string;
  accountId: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  isManaged: boolean;
  current: PerfTotals;
  previous: PerfTotals;
  kpi: PrimaryKpi;
  previousKpi: PrimaryKpi;
  series: DailyPoint[];
};

export type WorkspaceChangeEvent = {
  id: string;
  occurredAt: string;
  entityLevel: string;
  entityName: string | null;
  changeKind: string;
  source: string;
  actor: string | null;
  note: string | null;
  changedFields: Record<string, unknown>;
};

export type WorkspaceRange = {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
};

export type WorkspaceClientDetail = {
  client: WorkspaceClient;
  campaigns: WorkspaceCampaign[];
  changes: WorkspaceChangeEvent[];
  alerts: WorkspaceAlert[];
  recentlyClosedAlerts: Array<WorkspaceAlert & { status: string; reviewedBy: string | null; reviewNote: string | null; reviewedAt: string | null }>;
};
