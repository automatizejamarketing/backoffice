/**
 * Próximo passo de um cliente: UMA frase com a coisa mais importante a fazer
 * agora. Puro (servidor, navegador e testes). A Jornada mostra no cartão; a
 * Fila e a Mesa usam como motivo da linha quando cabe.
 *
 * Cor: `critical` (vermelho) só para Meta desconectada, conta travada na Meta,
 * gasto sem resultado e cliente parado com dinheiro em jogo; `attention`
 * (texto âmbar) para o resto que pede ação; `neutral` sem cor.
 */
import type { ClientJourney } from "@/lib/consultant-workspace/journey";
import { formatMoney, formatRoas, goalStatus } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceAlert, WorkspaceClient, WorkspaceGoal } from "@/lib/consultant-workspace/types";

export type NextStepTone = "critical" | "attention" | "neutral";

export type NextStep = {
  text: string;
  tone: NextStepTone;
  /** Tags de problema que a frase já diz (o cartão não repete como "+N"). */
  covers: string[];
};

export type NextStepAlert = Pick<WorkspaceAlert, "ruleId" | "severity" | "family"> & { ruleTitle?: string };

export type NextStepExtras = {
  /** Alertas abertos (sem os tratados/adiados) do cliente. */
  alerts?: ReadonlyArray<NextStepAlert>;
  /** Quanto rodava por semana antes de parar (só a Jornada lê). */
  stopped?: { weekSpend: number } | null;
  /** Meta combinada: decide "CPA acima" ou "ROAS abaixo". */
  goal?: Pick<WorkspaceGoal, "kpi" | "target"> | null;
};

const RECONNECT = "Reconectar o Facebook";
const CERTIFY = "Liberar a conta na Meta (não discriminação)";
const CERTIFY_TAGS = ["certificacao_meta", "acesso_parceiro"];

/** Alertas de performance → ação, na ordem em que valem mais. */
const ALERT_RULES = {
  noDelivery: "playbook.no_delivery",
  creative: "playbook.creative_diagnosis",
  cpa: "playbook.cpa_alert",
  roasLow: "playbook.roas_trigger",
  roasDecline: "playbook.roas_decline",
  roasScale: "playbook.roas_scale",
} as const;

/** "Campanha parada (consultor)" → "Campanha parada". */
export function cleanRuleTitle(title: string) {
  return title.replace(/\s*\((consultor|cliente)\)\s*$/i, "").trim();
}

function step(text: string, tone: NextStepTone, covers: string[] = []): NextStep {
  return { text, tone, covers };
}

export function nextStep(
  client: WorkspaceClient,
  journey: ClientJourney,
  { alerts = [], stopped = null, goal = null }: NextStepExtras = {},
): NextStep | null {
  const health = client.meta.health;
  const metaDown = health === "token_invalido";
  const metaOk = !metaDown && health !== "sem_meta";
  const certification = journey.steps.find((entry) => entry.key === "certificacao");
  const certBlocked = metaOk && certification != null && !certification.done;

  if (journey.stage === "onboarding") {
    switch (journey.blocker?.key) {
      case "acesso":
        return step("Acesso vencido — confirmar com o CS", "neutral");
      case "meta":
        return metaDown
          ? step(RECONNECT, "critical", ["reconectar_facebook"])
          : step("Conectar o Facebook", "neutral", ["sem_meta"]);
      case "certificacao":
        return step(CERTIFY, "critical", CERTIFY_TAGS);
      case "campanha":
        return step("Publicar a 1ª campanha", "neutral");
      case "veiculando":
        return step("Esperar a 1ª veiculação", "neutral");
      default:
        return null;
    }
  }

  if (journey.stage === "parado") {
    const week = stopped?.weekSpend ?? 0;
    const money = week > 0 ? ` — rodava ${formatMoney(week, false)}/semana` : "";
    if (metaDown) return step(`${RECONNECT}${money}`, "critical", ["reconectar_facebook"]);
    if (certBlocked) return step(CERTIFY, "critical", CERTIFY_TAGS);
    if (week > 0) return step(`Reativar${money}`, "critical");
    // Sem a leitura do gasto parado (Fila/Mesa): o período anterior diz se tinha dinheiro rodando.
    const previous = client.perf.previous.spend;
    if (!stopped && previous > 0) {
      return step(`Reativar — gastou ${formatMoney(previous, false)} no período anterior`, "critical");
    }
    return step("Reativar as campanhas", "neutral");
  }

  // Rodando.
  if (metaDown) return step(RECONNECT, "critical", ["reconectar_facebook"]);
  if (certBlocked) return step(CERTIFY, "critical", CERTIFY_TAGS);
  const kpi = client.perf.kpi;
  if (client.perf.current.spend > 0 && kpi.count === 0) {
    return step("Gastando sem resultado — checar pixel e criativo", "critical", ["sem_resultado", "pixel"]);
  }

  const performance = alerts.filter((alert) => alert.family === "playbook");
  const open = (ruleId: string) => performance.some((alert) => alert.ruleId === ruleId && alert.severity !== "info");
  const cost = kpi.cost != null ? `${kpi.costLabel} ${formatMoney(kpi.cost)}` : null;

  if (open(ALERT_RULES.noDelivery)) {
    return step("Campanha ativa sem entrega — checar saldo e aprovação", "attention", ["pagamento_meta"]);
  }
  if (open(ALERT_RULES.creative)) return step(cost ? `Trocar criativo — ${cost}` : "Trocar criativo", "attention", ["criativos"]);
  if (open(ALERT_RULES.cpa)) {
    return step(cost ? `Revisar público e oferta — ${cost}` : "Revisar público e oferta", "attention");
  }
  if (open(ALERT_RULES.roasLow)) {
    return step(
      kpi.roas != null ? `Revisar oferta e criativo — ROAS ${formatRoas(kpi.roas)}` : "Revisar oferta e criativo — ROAS baixo",
      "attention",
    );
  }
  if (open(ALERT_RULES.roasDecline)) return step("ROAS em queda — revisar criativo e público", "attention");

  const offGoal =
    journey.attentionReasons.includes("Fora da meta") || (goal ? goalStatus(kpi, goal as WorkspaceGoal).status === "fora" : false);
  if (offGoal) {
    return goal?.kpi === "roas"
      ? step(`ROAS abaixo da meta — ${formatRoas(kpi.roas)}`, "attention")
      : step(`${kpi.costLabel} acima da meta${kpi.cost != null ? ` — ${formatMoney(kpi.cost)}` : ""}`, "attention");
  }

  const other = performance.find((alert) => alert.severity !== "info" && alert.ruleId !== ALERT_RULES.roasScale);
  if (other) return step(cleanRuleTitle(other.ruleTitle ?? "Alerta de performance aberto"), "attention");

  if (performance.some((alert) => alert.ruleId === ALERT_RULES.roasScale)) {
    return step(kpi.roas != null ? `Pronta para escalar — ROAS ${formatRoas(kpi.roas)}` : "Pronta para escalar", "neutral");
  }
  return null;
}

/** Tags que o cartão ainda precisa sinalizar ("+N"): as que a frase do próximo passo não cobre. */
export function extraTags<T extends { key: string }>(tags: T[], step: NextStep | null): T[] {
  if (!step) return tags;
  return tags.filter((tag) => !step.covers.includes(tag.key));
}
