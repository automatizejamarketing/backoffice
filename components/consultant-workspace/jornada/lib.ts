/**
 * Regras da Jornada e da página do cliente — puras, sem React. A etapa e as
 * tags vêm de `lib/consultant-workspace/journey.ts`; aqui ficam só os detalhes
 * de apresentação.
 */
import {
  MESSAGE_TEMPLATES,
  PROBLEM_TAG_BY_KEY,
  TEMPLATE_BY_KEY,
  renderTemplate,
  type ClientJourney,
  type JourneyExtras,
  type JourneyStage,
  type JourneyStepKey,
  type MessageTemplate,
  type ProblemTag,
} from "@/lib/consultant-workspace/journey";
import { emptyTotals, primaryKpi } from "@/lib/consultant-workspace/metrics";
import type {
  ConsultantKey,
  WorkspaceAlert,
  WorkspaceClient,
  WorkspaceRange,
  WorkspaceState,
} from "@/lib/consultant-workspace/types";
import type { AssignedConsultant } from "@/components/consultant-workspace/common/assignment";
import { plural } from "@/components/consultant-workspace/common/signal-helpers";

export { plural };

/** Alerta enxuto para listas (o quadro não precisa de evidência nem métricas). */
export type SlimAlert = Pick<
  WorkspaceAlert,
  "id" | "userId" | "ruleId" | "ruleTitle" | "family" | "severity" | "createdAt" | "entityName"
>;

export function slimAlert(alert: WorkspaceAlert): SlimAlert {
  return {
    id: alert.id,
    userId: alert.userId,
    ruleId: alert.ruleId,
    ruleTitle: alert.ruleTitle,
    family: alert.family,
    severity: alert.severity,
    createdAt: alert.createdAt,
    entityName: alert.entityName,
  };
}

export type StoppedSpend = {
  /** Último dia com gasto. */
  lastSpendDate: string;
  /** Gasto nos 7 dias que terminam no último dia com gasto — o dinheiro que parou. */
  weekSpend: number;
};

/** O que a Jornada e os Playbooks leem (sempre 7 dias). Só strings e números: vai em JSON. */
export type BoardData = {
  range: WorkspaceRange;
  clients: WorkspaceClient[];
  alerts: SlimAlert[];
  extras: Record<string, JourneyExtras>;
  stopped: Record<string, StoppedSpend>;
  store: WorkspaceState;
  /** Alertas já tratados que não estão mais abertos: id → cliente (para "você tratou hoje"). */
  touchedAlertUser: Record<string, string>;
};

/** `computeJourney` pede o alerta completo; os campos de texto não pesam na regra. */
export function fillAlert(alert: SlimAlert): WorkspaceAlert {
  return {
    ...alert,
    title: alert.ruleTitle,
    evidence: "",
    recommendation: "",
    entityLevel: "",
    entityId: "",
    actionType: "",
    metrics: {},
  };
}

/** O que já foi tratado/adiado some da tela na hora, sem esperar o servidor. */
export function isAlertLive(alert: { id: string }, store: WorkspaceState, now: number) {
  const action = store.alertActions[alert.id];
  if (!action) return true;
  if (action.status === "snoozed") {
    return !!action.snoozeUntil && new Date(action.snoozeUntil).getTime() <= now;
  }
  return false;
}

/** Responsável do cliente, já com a troca feita nesta aba. */
export function consultantOf(
  client: WorkspaceClient,
  assignments: Map<string, AssignedConsultant>,
): ConsultantKey | null {
  const assigned = assignments.get(client.userId);
  return assigned ? assigned.id : client.consultant.key;
}

/** Regras de conta que são de outra área (cobrança/CS), não do gestor de tráfego. */
export function isOtherAreaAlert(alert: Pick<WorkspaceAlert, "ruleId" | "family">) {
  return alert.family === "account" && alert.ruleId !== "account.no_active_campaign";
}

export const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_SALES: "Vendas",
  OUTCOME_LEADS: "Cadastros",
  OUTCOME_ENGAGEMENT: "Engajamento/Mensagens",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "Promoção de app",
  MESSAGES: "Mensagens",
  CONVERSIONS: "Conversões",
  LINK_CLICKS: "Tráfego",
};

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Pausada",
  ADSET_PAUSED: "Conjuntos pausados",
  ARCHIVED: "Arquivada",
  DELETED: "Excluída",
  IN_PROCESS: "Em processamento",
  WITH_ISSUES: "Com problemas",
  PENDING_REVIEW: "Em análise",
  DISAPPROVED: "Reprovada",
};

export function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

/** Datas do banco vêm como "2026-10-13 11:06:07.532"; normaliza para ISO. */
export function toIso(value: string) {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** "1 conversa", "2 conversas" a partir do rótulo do KPI ("Conversas", "Compras"…). */
export function kpiUnit(count: number, label: string) {
  const lower = label.toLowerCase();
  return count === 1 ? lower.replace(/s$/, "") : lower;
}

/* ------------------------------------------------------------------ */
/* Bloqueio do onboarding → o que fazer agora                          */
/* ------------------------------------------------------------------ */

export type BlockerPlan = {
  title: string;
  steps: string[];
  tag: ProblemTag | null;
  templateKey: string | null;
};

const tag = (key: string) => PROBLEM_TAG_BY_KEY.get(key) ?? null;

function pickTag(journey: ClientJourney, candidates: string[]): ProblemTag | null {
  const active = journey.tags.find((item) => candidates.includes(item.key));
  return active ?? tag(candidates[0]);
}

export function blockerPlan(journey: ClientJourney, client: WorkspaceClient): BlockerPlan | null {
  const blocker = journey.blocker;
  if (!blocker) return null;
  const key: JourneyStepKey = blocker.key;
  if (key === "acesso") {
    return {
      title: "Acesso vencido",
      steps: [
        "Confira com o CS/Financeiro se o trial venceu ou o pagamento falhou.",
        "Se o cliente quer seguir, o Financeiro reativa; o tráfego espera.",
        "Com acesso de volta, siga para a conexão do Facebook.",
      ],
      tag: null,
      templateKey: "follow_up",
    };
  }
  if (key === "meta") {
    const chosen = pickTag(
      journey,
      client.meta.health === "token_invalido" ? ["reconectar_facebook", "sem_meta"] : ["sem_meta", "reconectar_facebook"],
    );
    return {
      title: chosen?.label ?? "Conectar o Facebook",
      steps: chosen?.playbook ?? [],
      tag: chosen,
      templateKey: chosen?.templateKey ?? "conectar_meta",
    };
  }
  if (key === "certificacao") {
    const chosen = pickTag(journey, ["certificacao_meta", "acesso_parceiro"]);
    return {
      title: chosen?.label ?? "Liberação da Meta",
      steps: chosen?.playbook ?? [],
      tag: chosen,
      templateKey: chosen?.templateKey ?? "certificacao_meta",
    };
  }
  if (key === "campanha") {
    const setupIncluded = client.plan.tier === "pro" || client.plan.tier === "premium";
    return {
      title: "Subir a 1ª campanha",
      steps: setupIncluded
        ? [
            "Combine com o cliente o objetivo da 1ª campanha (vendas, conversas ou cadastros) e a verba do mês.",
            "Monte a campanha pela Automatize — o plano dele inclui o setup.",
            "Registre a meta (custo por resultado e verba) nesta ficha para os alertas medirem contra ela.",
            "Avise o cliente quando estiver no ar.",
          ]
        : [
            "Confirme se o cliente sabe criar a campanha automática no app (Marketing › Nova campanha).",
            "Se travou, mande o passo a passo ou ofereça 10 minutos de chamada.",
            "Confira em 2 dias se a campanha apareceu.",
          ],
      tag: null,
      templateKey: setupIncluded ? "boas_vindas" : "follow_up",
    };
  }
  if (key === "veiculando") {
    const chosen = pickTag(journey, ["pagamento_meta", "conta_restrita", "certificacao_meta"]);
    return {
      title: "Campanha publicada que ainda não gastou",
      steps: [
        "Confira se a campanha está ativa e aprovada — em análise ou reprovada ela não gasta.",
        ...(chosen?.playbook ?? []),
      ],
      tag: chosen,
      templateKey: chosen?.templateKey ?? "primeira_campanha",
    };
  }
  return {
    title: blocker.label,
    steps: [blocker.hint],
    tag: null,
    templateKey: null,
  };
}

/* ------------------------------------------------------------------ */
/* Mensagens sugeridas                                                  */
/* ------------------------------------------------------------------ */

const STAGE_DEFAULT_TEMPLATE: Record<JourneyStage, string> = {
  onboarding: "boas_vindas",
  rodando: "resumo_semanal",
  parado: "campanha_parada",
};

/** Ordem: o que foi pedido, as tags do cliente, o bloqueio, a etapa, o resto da etapa. */
export function suggestedTemplateKeys(
  journey: ClientJourney,
  client: WorkspaceClient,
  preferred?: string | null,
): string[] {
  const keys: string[] = [];
  const push = (key: string | null | undefined) => {
    if (key && TEMPLATE_BY_KEY.has(key) && !keys.includes(key)) keys.push(key);
  };
  push(preferred);
  for (const item of journey.tags) push(item.templateKey);
  push(blockerPlan(journey, client)?.templateKey);
  push(STAGE_DEFAULT_TEMPLATE[journey.stage]);
  for (const template of MESSAGE_TEMPLATES) {
    if (template.stages.includes(journey.stage)) push(template.key);
  }
  return keys;
}

/** A mensagem que o botão "Mensagem" do cartão já abre selecionada. */
export function primaryTemplateKey(journey: ClientJourney, client: WorkspaceClient): string {
  if (journey.stage === "rodando" && !journey.needsAttention) return "resumo_semanal";
  return suggestedTemplateKeys(journey, client)[0] ?? STAGE_DEFAULT_TEMPLATE[journey.stage];
}

export function templateOf(key: string | null | undefined): MessageTemplate | null {
  return key ? (TEMPLATE_BY_KEY.get(key) ?? null) : null;
}

/** `renderTemplate` sem os espaços duplos que sobram quando uma variável vem vazia. */
export function renderMessage(
  template: MessageTemplate,
  client: WorkspaceClient,
  options: { consultantName?: string | null; nextStep?: string | null } = {},
) {
  return renderTemplate(template, client, options).replace(/[ \t]{2,}/g, " ").trim();
}

/** Trechos que o gestor ainda precisa completar à mão: [seu nome], [o que você vai fazer]… */
export function placeholdersIn(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{1,60}\]/g) ?? [])];
}

/* ------------------------------------------------------------------ */
/* Análise da IA                                                        */
/* ------------------------------------------------------------------ */

export type AiSection = { title: string | null; lines: Array<{ kind: "bullet" | "text"; text: string }> };

/** Quebra o texto do modelo em seções pelos títulos `**Assim**`. */
export function parseAiAnalysis(text: string): AiSection[] {
  const sections: AiSection[] = [];
  let current: AiSection = { title: null, lines: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{0,3}\s*\*\*(.+?)\*\*:?\s*(.*)$/);
    if (heading) {
      if (current.title || current.lines.length) sections.push(current);
      current = { title: heading[1].replace(/:$/, "").trim(), lines: [] };
      if (heading[2]) current.lines.push(lineOf(heading[2]));
      continue;
    }
    current.lines.push(lineOf(line));
  }
  if (current.title || current.lines.length) sections.push(current);
  return sections;
}

function lineOf(line: string): AiSection["lines"][number] {
  const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
  return bullet ? { kind: "bullet", text: bullet[1] } : { kind: "text", text: line };
}

/** A frase de "Para dizer ao cliente", sem aspas, para virar o próximo passo do resumo. */
export function clientSentenceFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const section = parseAiAnalysis(text).find((item) => item.title?.toLowerCase().includes("dizer ao cliente"));
  const sentence = section?.lines.map((line) => line.text).join(" ").trim();
  if (!sentence) return null;
  return sentence.replace(/^[“"']+|[”"']+$/g, "").trim();
}

/* ------------------------------------------------------------------ */
/* Cliente de exemplo (prévia dos templates na biblioteca)              */
/* ------------------------------------------------------------------ */

function sampleTotals(spend: number, purchases: number, value: number) {
  return { ...emptyTotals(), spend, purchases, purchaseValue: value, results: purchases, impressions: spend * 90 };
}

const SAMPLE_CURRENT = sampleTotals(840, 42, 3360);
const SAMPLE_PREVIOUS = sampleTotals(790, 33, 2640);

export const SAMPLE_CLIENT: WorkspaceClient = {
  userId: "exemplo",
  email: "contato@exemplo.com.br",
  name: "Marina Souza",
  companyName: "Hamburgueria da Marina",
  displayName: "Hamburgueria da Marina",
  phone: "11999990000",
  plan: { tier: "pro", period: "monthly", status: "active", provider: "stripe", renewalAt: null },
  accessUntil: null,
  access: "pagante",
  consultant: { key: null, name: null, email: null },
  meta: { health: "ok", detail: null, accountName: null, hasActiveManagedCampaign: true, checkedAt: null },
  publishHolds: 0,
  perf: {
    current: SAMPLE_CURRENT,
    previous: SAMPLE_PREVIOUS,
    kpi: primaryKpi(SAMPLE_CURRENT, "compras"),
    previousKpi: primaryKpi(SAMPLE_PREVIOUS, "compras"),
    series: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-0${index + 1}`, spend: 120, results: 6 })),
    monthToDateSpend: 1440,
    activeCampaigns: 2,
  },
  alerts: { open: 0, critical: 0, warning: 0, info: 0, oldestOpenAt: null },
  lastConsultantTouchAt: null,
};

export const VARIABLE_LABEL: Record<string, string> = {
  primeiro_nome: "primeiro nome",
  empresa: "empresa",
  consultor: "seu nome",
  dias: "dias do período",
  gasto: "investido",
  resultado: "resultado",
  custo_label: "nome do custo",
  custo: "custo por resultado",
  comparacao: "comparação com o período anterior",
  proximo_passo: "próximo passo",
};
