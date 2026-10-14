/**
 * UM modelo por cliente, usado pela Fila, pela Mesa e pelo resumo da Jornada.
 *
 * Junta: sinais e prioridade, métricas do período, a régua por plano
 * (Premium tudo, Pro só problema, Starter só exceção) e a jornada (etapa,
 * bloqueio, tags de problema). Puro, sem React.
 */
import {
  GOAL_KPI_LABEL,
  PLAN_LABEL,
  budgetPacing,
  delta,
  formatMoney,
  formatRoas,
  goalStatus,
} from "@/lib/consultant-workspace/metrics";
import {
  computeJourney,
  PROBLEM_TAG_BY_KEY,
  type ClientJourney,
  type JourneyExtras,
  type JourneyStage,
} from "@/lib/consultant-workspace/journey";
import type {
  ConsultantKey,
  PlanTier,
  WorkspaceAlert,
  WorkspaceClient,
  WorkspaceGoal,
  WorkspaceRange,
  WorkspaceState,
} from "@/lib/consultant-workspace/types";
import { cleanRuleTitle, nextStep, type NextStep, type NextStepTone } from "./next-step";
import {
  humanize,
  isHidden,
  plural,
  syntheticKey,
  syntheticUserOf,
  type Severity,
  type SyntheticKind,
} from "./signal-helpers";

export type { Severity };

export type SignalKind = "alerta" | SyntheticKind;

export type Signal = {
  /** id do alerta no banco, ou chave sintética `sinal:<tipo>:<userId>`. */
  key: string;
  kind: SignalKind;
  severity: Severity;
  title: string;
  evidence: string;
  recommendation: string | null;
  since: string | null;
  alert?: WorkspaceAlert;
  /** Cobrança/cancelamento: é do Financeiro/CS, não do tráfego. */
  otherArea: boolean;
  /** Atalho que resolve o sinal de verdade (além de concluir). */
  fix?: "nota" | "meta";
};

/** fila = precisa de gente pelo que o plano promete; automatico = a máquina segue; outras_areas = cobrança. */
export type Bucket = "fila" | "automatico" | "outras_areas";

export type PlanGroup = "premium" | "pro" | "starter";

export type CarteiraRow = {
  userId: string;
  client: WorkspaceClient;
  title: string;
  planGroup: PlanGroup;
  /** Responsável (id do consultor no backoffice). */
  consultant: ConsultantKey | null;
  consultantName: string | null;
  goal: WorkspaceGoal | undefined;
  goalInfo: ReturnType<typeof goalStatus>;
  pacing: ReturnType<typeof budgetPacing>;
  liveAlerts: WorkspaceAlert[];
  alertCounts: { open: number; critical: number; warning: number; info: number };
  /** Sinais vivos (sem os tratados/adiados). */
  signals: Signal[];
  trafficSignals: Signal[];
  otherAreaSignals: Signal[];
  /** O que "Concluir"/"Adiar" fecham. */
  actionIds: string[];
  worst: Severity | null;
  /** A linha que resume os sinais: o grupo mais grave, quantas vezes, e quantos outros grupos. */
  headline: { title: string; times: number; others: number } | null;
  score: number;
  /** Posição na fila inteira (só para quem está na fila). */
  rank: number | null;
  reason: string;
  bucket: Bucket | null;
  journey: ClientJourney;
  /** A coisa mais importante a fazer agora (mesma regra do cartão da Jornada). */
  step: NextStep | null;
  lastTouch: string | null;
  daysSinceTouch: number | null;
  touchOverdue: boolean;
  spendDelta: number | null;
  countDelta: number | null;
  costDelta: number | null;
  searchText: string;
};

export const PLAN_WEIGHT: Record<PlanTier, number> = { premium: 3, pro: 2, starter: 1, sem_plano: 0.5 };
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "crítico", warning: "atenção", info: "sugestão" };

const OTHER_AREA_RULES = new Set([
  "account.card_payment_failed",
  "account.pix_expiring",
  "account.recently_canceled",
]);

export function planGroupOf(tier: PlanTier): PlanGroup {
  return tier === "premium" ? "premium" : tier === "pro" ? "pro" : "starter";
}

/** Nome para título: nunca o e-mail quando houver outro. */
export function clientTitle(client: Pick<WorkspaceClient, "companyName" | "name" | "displayName" | "email">) {
  return client.companyName ?? client.name ?? (client.displayName !== client.email ? client.displayName : client.email);
}

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const time = new Date(iso.includes("T") ? iso : iso.replace(" ", "T")).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

function maxIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

const BLOCKER_TAG: Record<string, string | null> = {
  meta: "sem_meta",
  certificacao: "certificacao_meta",
  campanha: null,
  veiculando: "pagamento_meta",
  acesso: null,
};

export function daysInStageText(journey: ClientJourney) {
  const days = journey.daysInStage;
  if (days == null) return null;
  const span = days === 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`;
  if (journey.stage === "onboarding") return days === 0 ? "entrou hoje" : `no onboarding ${span}`;
  if (journey.stage === "parado") return days === 0 ? "parou ontem" : `parado ${span}`;
  return days === 0 ? "rodando desde ontem" : `rodando ${span}`;
}

type SignalContext = {
  client: WorkspaceClient;
  alerts: WorkspaceAlert[];
  goal: WorkspaceGoal | undefined;
  goalInfo: ReturnType<typeof goalStatus>;
  pacing: ReturnType<typeof budgetPacing>;
  journey: ClientJourney;
  daysSinceTouch: number | null;
};

/** Sinais de um cliente antes de esconder os tratados/adiados. */
export function rawSignals({ client, alerts, goal, goalInfo, pacing, journey, daysSinceTouch }: SignalContext): Signal[] {
  const userId = client.userId;
  const tier = client.plan.tier;
  const signals: Signal[] = alerts.map((alert) => ({
    key: alert.id,
    kind: "alerta",
    severity: alert.severity,
    title: alert.ruleTitle || alert.title,
    evidence: humanize(alert.evidence),
    recommendation: alert.recommendation ? humanize(alert.recommendation) : null,
    since: alert.createdAt,
    alert,
    otherArea: OTHER_AREA_RULES.has(alert.ruleId),
  }));

  const health = client.meta.health;
  if (health === "token_invalido" || health === "erro_checagem") {
    const broken = health === "token_invalido";
    signals.push({
      key: syntheticKey("meta", userId),
      kind: "meta",
      severity: broken ? "critical" : "warning",
      title: broken ? "Meta desconectada — precisa reconectar" : "Erro ao ler a conta de anúncios",
      evidence: broken
        ? "A Automatize perdeu o acesso à conta de anúncios. Nada é publicado nem medido até reconectar."
        : `A última leitura da conta falhou${client.meta.detail ? `: ${humanize(client.meta.detail).slice(0, 140)}` : "."}`,
      recommendation: broken
        ? "Pedir ao cliente para reconectar a Meta no app (Marketing › Reconectar)."
        : "Conferir se a conta de anúncios continua ativa e com permissão para a Automatize.",
      since: client.meta.checkedAt,
      otherArea: false,
    });
  }

  if (client.perf.current.spend === 0 && client.perf.previous.spend > 0) {
    signals.push({
      key: syntheticKey("sem_entrega", userId),
      kind: "sem_entrega",
      severity: "critical",
      title: "Parou de entregar",
      evidence: `Gastou ${formatMoney(client.perf.previous.spend, false)} no período anterior e nada neste.`,
      recommendation: "Ver se as campanhas foram pausadas, se falta saldo ou se houve reprovação.",
      since: null,
      otherArea: false,
    });
  }

  if (goal && goalInfo.status === "fora" && goalInfo.actual != null) {
    const actual = goal.kpi === "roas" ? formatRoas(goalInfo.actual) : formatMoney(goalInfo.actual);
    const target = goal.kpi === "roas" ? formatRoas(goal.target) : formatMoney(goal.target);
    signals.push({
      key: syntheticKey("fora_da_meta", userId),
      kind: "fora_da_meta",
      severity: "warning",
      title: "Fora da meta combinada",
      evidence: `${GOAL_KPI_LABEL[goal.kpi]}: ${target}. No período: ${actual}.`,
      recommendation: "Revisar oferta, criativo e público — ou reajustar a meta com o cliente.",
      since: goal.updatedAt ?? null,
      otherArea: false,
      fix: "meta",
    });
  }

  if (client.publishHolds > 0) {
    signals.push({
      key: syntheticKey("retido", userId),
      kind: "retido",
      severity: "warning",
      title: plural(client.publishHolds, "publicação retida", "publicações retidas"),
      evidence: "Há campanha esperando a Meta liberar a conta (erro de não discriminação).",
      recommendation:
        PROBLEM_TAG_BY_KEY.get("certificacao_meta")?.playbook[1] ??
        "Pedir ao cliente o login com o Facebook pessoal na Automatize.",
      since: null,
      otherArea: false,
    });
  }

  // Onboarding parado: é o "setup da 1ª campanha" do Pro e o gerente dedicado do Premium.
  const blocker = journey.blocker;
  if (
    journey.stage === "onboarding" &&
    blocker &&
    (tier === "premium" || tier === "pro") &&
    !(blocker.key === "meta" && health === "token_invalido") &&
    !(blocker.key === "certificacao" && client.publishHolds > 0)
  ) {
    const tagKey = blocker.key === "meta" && health !== "sem_meta" ? "reconectar_facebook" : BLOCKER_TAG[blocker.key];
    const tag = tagKey ? PROBLEM_TAG_BY_KEY.get(tagKey) : null;
    const days = journey.daysInStage;
    signals.push({
      key: syntheticKey("onboarding", userId),
      kind: "onboarding",
      severity: days != null && days > 7 ? "warning" : "info",
      title: `Onboarding travado em “${blocker.label}”`,
      evidence: `${blocker.hint}${days != null ? ` ${daysInStageText(journey)?.replace(/^./, (c) => c.toUpperCase())}.` : ""}`,
      recommendation:
        tag?.playbook[0] ??
        (blocker.key === "campanha"
          ? "Montar a 1ª campanha com o cliente (é o setup que o plano promete)."
          : "Conferir o acesso do cliente com o CS."),
      since: null,
      otherArea: false,
    });
  }

  // Premium: o gerente dedicado precisa de meta combinada, contato frequente e verba no ritmo.
  if (tier === "premium") {
    if (!goal) {
      signals.push({
        key: syntheticKey("sem_meta_definida", userId),
        kind: "sem_meta_definida",
        severity: "info",
        title: "Sem meta combinada",
        evidence: `Sem meta não dá para dizer se está bom ou ruim.${
          client.perf.kpi.cost != null ? ` Hoje: ${client.perf.kpi.costLabel} ${formatMoney(client.perf.kpi.cost)}.` : ""
        }`,
        recommendation: "Combinar com o cliente o custo aceitável e a verba do mês.",
        since: null,
        otherArea: false,
        fix: "meta",
      });
    }
    if (daysSinceTouch == null || daysSinceTouch > 7) {
      signals.push({
        key: syntheticKey("sem_contato", userId),
        kind: "sem_contato",
        severity: daysSinceTouch == null || daysSinceTouch > 14 ? "warning" : "info",
        title: daysSinceTouch == null ? "Nunca teve contato registrado" : `Sem contato há ${daysSinceTouch} dias`,
        evidence: "O plano Premium promete gerente dedicado e reunião mensal.",
        recommendation: "Mandar o resumo da semana ou marcar a reunião do mês — e registrar aqui.",
        since: null,
        otherArea: false,
        fix: "nota",
      });
    }
    if (pacing && goal?.monthlyBudget && (pacing.ratio < 0.8 || pacing.ratio > 1.15)) {
      signals.push({
        key: syntheticKey("ritmo", userId),
        kind: "ritmo",
        severity: "warning",
        title: pacing.ratio < 0.8 ? "Verba abaixo do ritmo combinado" : "Verba acima do ritmo combinado",
        evidence: `Gastou ${formatMoney(client.perf.monthToDateSpend, false)} no mês; o esperado até ontem era ${formatMoney(pacing.expected, false)} de ${formatMoney(goal.monthlyBudget, false)}.`,
        recommendation:
          pacing.ratio < 0.8
            ? "Subir orçamento das campanhas que estão na meta."
            : "Segurar o orçamento para não estourar a verba do mês.",
        since: null,
        otherArea: false,
      });
    }
    if (goalInfo.status === "perto") {
      signals.push({
        key: syntheticKey("perto_da_meta", userId),
        kind: "perto_da_meta",
        severity: "info",
        title: "Perto de sair da meta",
        evidence: "Até 10% pior que o alvo combinado.",
        recommendation: "Olhar o criativo de maior gasto antes que passe do limite.",
        since: null,
        otherArea: false,
      });
    }
  }
  return signals;
}

export type SignalGroup = { id: string; signals: Signal[] };

/** Sinais da mesma regra viram um grupo ("Diagnóstico de criativo × 12"). Pior e maior primeiro. */
export function groupSignals(signals: Signal[]): SignalGroup[] {
  const groups = new Map<string, SignalGroup>();
  for (const signal of signals) {
    const id = signal.alert ? `rule:${signal.alert.ruleId}` : signal.key;
    const group = groups.get(id) ?? { id, signals: [] };
    group.signals.push(signal);
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Math.max(...b.signals.map((s) => SEVERITY_WEIGHT[s.severity])) -
        Math.max(...a.signals.map((s) => SEVERITY_WEIGHT[s.severity])) ||
      Number(a.signals[0].kind === "alerta") - Number(b.signals[0].kind === "alerta") ||
      b.signals.length - a.signals.length,
  );
}

function sortSignals(signals: Signal[]) {
  return [...signals].sort(
    (a, b) =>
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
      Number(a.kind === "alerta") - Number(b.kind === "alerta") ||
      (a.since ?? "").localeCompare(b.since ?? ""),
  );
}

function worstOf(signals: Signal[]): Severity | null {
  if (signals.length === 0) return null;
  if (signals.some((signal) => signal.severity === "critical")) return "critical";
  if (signals.some((signal) => signal.severity === "warning")) return "warning";
  return "info";
}

/** A régua por plano: o que faz cada cliente precisar de gente. */
function needsHuman(tier: PlanTier, signal: Signal) {
  if (tier === "premium") return true;
  if (tier === "pro") return signal.kind !== "alerta" || signal.severity === "critical";
  return (
    signal.kind === "meta" ||
    signal.kind === "sem_entrega" ||
    (signal.kind === "alerta" && signal.severity === "critical")
  );
}

export type BuildInput = {
  clients: WorkspaceClient[];
  alerts: WorkspaceAlert[];
  extras: Record<string, JourneyExtras>;
  store: WorkspaceState;
  range: WorkspaceRange;
  now: number;
  /** Troca de responsável feita nesta aba (a leitura do servidor guarda 2 minutos de cache). */
  assignments?: Map<string, { id: string | null; name: string | null }>;
};

export function buildRows({ clients, alerts, extras, store, range, now, assignments }: BuildInput): CarteiraRow[] {
  const alertsByUser = new Map<string, WorkspaceAlert[]>();
  for (const alert of alerts) {
    if (isHidden(alert.id, store.alertActions[alert.id], now)) continue;
    const list = alertsByUser.get(alert.userId) ?? [];
    list.push(alert);
    alertsByUser.set(alert.userId, list);
  }
  const lastHuman = new Map<string, string>();
  for (const note of store.notes) {
    lastHuman.set(note.userId, maxIso(lastHuman.get(note.userId) ?? null, note.createdAt)!);
  }

  const rows: CarteiraRow[] = clients.map((client) => {
    const userId = client.userId;
    const tier = client.plan.tier;
    const liveAlerts = alertsByUser.get(userId) ?? [];
    const goal = store.goals[userId];
    const goalInfo = goalStatus(client.perf.kpi, goal);
    const pacing = budgetPacing(client.perf.monthToDateSpend, goal?.monthlyBudget, range);
    const journey = computeJourney(client, extras[userId], store, liveAlerts, goalInfo.status, now);
    const lastTouch = maxIso(client.lastConsultantTouchAt, lastHuman.get(userId) ?? null);
    const daysSinceTouch = daysBetween(lastTouch, now);

    const signals = rawSignals({ client, alerts: liveAlerts, goal, goalInfo, pacing, journey, daysSinceTouch }).filter(
      (signal) => !isHidden(signal.key, store.alertActions[signal.key], now),
    );
    const trafficSignals = sortSignals(signals.filter((signal) => !signal.otherArea));
    const otherAreaSignals = signals.filter((signal) => signal.otherArea);
    const scoring = trafficSignals.length ? trafficSignals : otherAreaSignals;
    const worst = worstOf(scoring);
    const groups = groupSignals(scoring);
    const headline = groups.length
      ? { title: groups[0].signals[0].title, times: groups[0].signals.length, others: groups.length - 1 }
      : null;
    const spendAtStake = Math.max(client.perf.current.spend, client.perf.previous.spend);
    const metaBroken = trafficSignals.some((signal) => signal.kind === "meta");
    const score = worst
      ? PLAN_WEIGHT[tier] * SEVERITY_WEIGHT[worst] * Math.log(spendAtStake + Math.E) * (metaBroken ? 1.5 : 1) *
        (trafficSignals.length ? 1 : 0.2)
      : 0;
    const bucket: Bucket | null =
      trafficSignals.length === 0
        ? otherAreaSignals.length
          ? "outras_areas"
          : null
        : trafficSignals.some((signal) => needsHuman(tier, signal))
          ? "fila"
          : "automatico";

    const reasonParts = worst
      ? [
          PLAN_LABEL[tier],
          SEVERITY_LABEL[worst],
          spendAtStake > 0 ? `${formatMoney(spendAtStake, false)} em jogo` : "sem gasto no período",
        ]
      : [];
    if (metaBroken) reasonParts.push("Meta quebrada");
    if (journey.stage === "onboarding" && trafficSignals.some((signal) => signal.kind === "onboarding")) {
      reasonParts.push("onboarding parado");
    }

    const paid = tier === "premium" || tier === "pro";
    const assigned = assignments?.get(userId);
    return {
      userId,
      client,
      title: clientTitle(client),
      planGroup: planGroupOf(tier),
      consultant: assigned ? assigned.id : client.consultant.key,
      consultantName: assigned ? assigned.name : client.consultant.name,
      goal,
      goalInfo,
      pacing,
      liveAlerts,
      alertCounts: {
        open: liveAlerts.length,
        critical: liveAlerts.filter((alert) => alert.severity === "critical").length,
        warning: liveAlerts.filter((alert) => alert.severity === "warning").length,
        info: liveAlerts.filter((alert) => alert.severity === "info").length,
      },
      signals,
      trafficSignals,
      otherAreaSignals,
      actionIds: scoring.map((signal) => signal.key),
      worst,
      headline,
      score,
      rank: null,
      reason: reasonParts.join(" · "),
      bucket,
      journey,
      step: nextStep(client, journey, { alerts: liveAlerts, goal }),
      lastTouch,
      daysSinceTouch,
      touchOverdue: paid && (daysSinceTouch == null || daysSinceTouch > 14),
      spendDelta: delta(client.perf.current.spend, client.perf.previous.spend),
      countDelta: delta(client.perf.kpi.count, client.perf.previousKpi.count),
      costDelta: delta(client.perf.kpi.cost, client.perf.previousKpi.cost),
      searchText: [clientTitle(client), client.email, client.name, client.companyName, client.meta.accountName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR"),
    };
  });

  const ranked = rows.filter((row) => row.bucket === "fila").sort((a, b) => b.score - a.score);
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

/**
 * O motivo da linha na Fila e na Mesa, em palavras: o próximo passo quando
 * há; senão, o sinal principal (ex.: "Sem contato há 9 dias"). Vermelho só no
 * crítico.
 */
export function rowReason(row: Pick<CarteiraRow, "step" | "headline" | "worst">): { text: string; tone: NextStepTone } | null {
  if (row.step) return { text: row.step.text, tone: row.step.tone };
  if (!row.headline) return null;
  return { text: cleanRuleTitle(row.headline.title), tone: row.worst === "critical" ? "critical" : "neutral" };
}

/** Clientes que você tratou hoje (concluídos ou dispensados) — o contador do topo. */
export function handledTodayCount(
  store: WorkspaceState,
  alertUser: Map<string, string>,
  now: number,
  byEmail: string,
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.getTime();
  const users = new Set<string>();
  for (const [key, action] of Object.entries(store.alertActions)) {
    if (action.status === "snoozed") continue;
    if (action.by.toLowerCase() !== byEmail.toLowerCase()) continue;
    if (new Date(action.at).getTime() < since) continue;
    const userId = syntheticUserOf(key) ?? alertUser.get(key);
    if (userId) users.add(userId);
  }
  return users.size;
}

export const STAGE_ORDER: JourneyStage[] = ["onboarding", "rodando", "parado"];
