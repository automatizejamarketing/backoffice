import {
  PLAYBOOK_DEFAULT_CPA_ALERT,
  PLAYBOOK_MIN_SPEND,
  PLAYBOOK_MIN_SPEND_STALLED,
  PLAYBOOK_ROAS_TRIGGER,
  PLAYBOOK_ROAS_VALIDATED,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_STALLED_DAYS,
} from "./constants";
import type {
  CampaignMetricsRow,
  PlaybookEvaluationResult,
  PlaybookInsightCandidate,
} from "./types";

function daysSince(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000));
}

function formatRoas(value: number): string {
  return value.toFixed(2);
}

export type PlaybookRuleThresholds = {
  minSpend?: number;
  roasTrigger?: number;
  roasValidated?: number;
  cpaAlert?: number;
  stalledPausedDays?: number;
  minSpendForStalled?: number;
};

export type PlaybookEvaluationConfig = {
  /** When omitted, all rules are enabled (back-compat). */
  enabledRuleIds?: Set<string> | ReadonlySet<string>;
  thresholdsByRuleId?: Map<string, PlaybookRuleThresholds> | ReadonlyMap<
    string,
    PlaybookRuleThresholds
  >;
  /** Legacy single CPA override used when rule map is absent. */
  cpaAlertThreshold?: number;
};

function isEnabled(
  config: PlaybookEvaluationConfig | undefined,
  ruleId: string,
): boolean {
  if (!config?.enabledRuleIds) return true;
  return config.enabledRuleIds.has(ruleId);
}

function thresholdsFor(
  config: PlaybookEvaluationConfig | undefined,
  ruleId: string,
): PlaybookRuleThresholds {
  return config?.thresholdsByRuleId?.get(ruleId) ?? {};
}

/**
 * Deterministic playbook evaluators for consultant-facing suggestions.
 * Source: food-service playbook ROAS/CPA bands + suporte playbook ops heuristics.
 * Thresholds come from proactivity_alerts when provided; else code defaults.
 */
export function evaluatePlaybookInsights(args: {
  accountId: string | null;
  campaigns: CampaignMetricsRow[];
  now?: Date;
  cpaAlertThreshold?: number;
  config?: PlaybookEvaluationConfig;
}): PlaybookEvaluationResult {
  const now = args.now ?? new Date();
  const config: PlaybookEvaluationConfig = {
    ...args.config,
    cpaAlertThreshold:
      args.config?.cpaAlertThreshold ?? args.cpaAlertThreshold,
  };
  const candidates: PlaybookInsightCandidate[] = [];

  for (const campaign of args.campaigns) {
    const status = campaign.effectiveStatus ?? campaign.status;
    const roas = campaign.purchaseRoas;

    if (isEnabled(config, PLAYBOOK_RULE_ROAS_TRIGGER)) {
      const t = thresholdsFor(config, PLAYBOOK_RULE_ROAS_TRIGGER);
      const minSpend = t.minSpend ?? PLAYBOOK_MIN_SPEND;
      const roasTrigger = t.roasTrigger ?? PLAYBOOK_ROAS_TRIGGER;
      if (
        status === "ACTIVE" &&
        campaign.spend >= minSpend &&
        roas !== null &&
        roas <= roasTrigger
      ) {
        candidates.push({
          ruleId: PLAYBOOK_RULE_ROAS_TRIGGER,
          severity: "warning",
          confidence: campaign.spend >= 150 ? "high" : "medium",
          entityLevel: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          actionType: "analyze_performance",
          title: "ROAS baixo — acionar análise",
          evidence: `Campanha "${campaign.name}" com ROAS ${formatRoas(roas)} (≤ ${roasTrigger}) e gasto R$ ${campaign.spend.toFixed(2)} nos últimos 30d.`,
          recommendation:
            "Seguir ordem do playbook: (1) pixel/eventos, (2) oferta/criativo com vantagem clara, (3) orçamento/janela mínima de análise, (4) horário de entrega. Não pausar por impulso — pausas frequentes resetam aprendizado.",
          metrics: {
            purchaseRoas: roas,
            spend: campaign.spend,
            purchases: campaign.purchases,
            impressions: campaign.impressions,
          },
        });
      }
    }

    if (isEnabled(config, PLAYBOOK_RULE_ROAS_SCALE)) {
      const t = thresholdsFor(config, PLAYBOOK_RULE_ROAS_SCALE);
      const minSpend = t.minSpend ?? PLAYBOOK_MIN_SPEND;
      const roasValidated = t.roasValidated ?? PLAYBOOK_ROAS_VALIDATED;
      if (
        (status === "ACTIVE" ||
          status === "COMPLETED" ||
          status === "ARCHIVED") &&
        campaign.spend >= minSpend &&
        roas !== null &&
        roas >= roasValidated
      ) {
        candidates.push({
          ruleId: PLAYBOOK_RULE_ROAS_SCALE,
          severity: "info",
          confidence: "high",
          entityLevel: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          actionType: "scale_or_extend",
          title: "ROAS validado — oportunidade de escala",
          evidence: `Campanha "${campaign.name}" com ROAS ${formatRoas(roas)} (≥ ${roasValidated}) e gasto R$ ${campaign.spend.toFixed(2)}.`,
          recommendation:
            status === "ACTIVE"
              ? "Campanha validada pelo playbook. Avaliar aumento de orçamento, extensão do período e reforço com novos criativos/ofertas sem quebrar a estrutura que está convertendo."
              : "Campanha encerrou com ROAS validado. Duplicar e estender para 30–45 dias com orçamento adequado ao período, preservando a inteligência acumulada.",
          metrics: {
            purchaseRoas: roas,
            spend: campaign.spend,
            purchases: campaign.purchases,
            effectiveStatus: status,
          },
        });
      }
    }

    if (isEnabled(config, PLAYBOOK_RULE_CPA_ALERT)) {
      const t = thresholdsFor(config, PLAYBOOK_RULE_CPA_ALERT);
      const minSpend = t.minSpend ?? PLAYBOOK_MIN_SPEND;
      const cpaAlert =
        t.cpaAlert ??
        config.cpaAlertThreshold ??
        PLAYBOOK_DEFAULT_CPA_ALERT;
      if (
        status === "ACTIVE" &&
        campaign.spend >= minSpend &&
        campaign.cpa !== null &&
        campaign.cpa > cpaAlert
      ) {
        candidates.push({
          ruleId: PLAYBOOK_RULE_CPA_ALERT,
          severity: "warning",
          confidence: "medium",
          entityLevel: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          actionType: "optimize_cpa",
          title: "CPA acima do alerta do playbook",
          evidence: `Campanha "${campaign.name}" com CPA R$ ${campaign.cpa.toFixed(2)} (alerta > R$ ${cpaAlert.toFixed(2)}) e ${campaign.purchases} compras.`,
          recommendation:
            "Revisar oferta/ticket, criativo com vantagem clara e qualidade do pixel. Comparar com faixa ideal do playbook por ticket médio do cliente antes de escalar verba.",
          metrics: {
            cpa: campaign.cpa,
            cpaAlert,
            spend: campaign.spend,
            purchases: campaign.purchases,
            purchaseRoas: roas,
          },
        });
      }
    }

    if (isEnabled(config, PLAYBOOK_RULE_STALLED)) {
      const t = thresholdsFor(config, PLAYBOOK_RULE_STALLED);
      const minSpendStalled = t.minSpendForStalled ?? PLAYBOOK_MIN_SPEND_STALLED;
      const stalledDays = t.stalledPausedDays ?? PLAYBOOK_STALLED_DAYS;
      if (
        (status === "PAUSED" || status === "CAMPAIGN_PAUSED") &&
        campaign.spend >= minSpendStalled
      ) {
        const pausedDays = daysSince(now, campaign.updatedTime);
        if (pausedDays !== null && pausedDays >= stalledDays) {
          candidates.push({
            ruleId: PLAYBOOK_RULE_STALLED,
            severity: "info",
            confidence: "medium",
            entityLevel: "campaign",
            entityId: campaign.id,
            entityName: campaign.name,
            actionType: "reactivate_or_close",
            title: "Campanha parada há vários dias",
            evidence: `Campanha "${campaign.name}" pausada há ${pausedDays} dias com gasto histórico R$ ${campaign.spend.toFixed(2)}.`,
            recommendation:
              "Decidir: reativar com continuidade (evitar liga/desliga) ou arquivar e redistribuir verba. Pausas frequentes aumentam custo ao retomar o aprendizado da Meta.",
            metrics: {
              pausedDays,
              spend: campaign.spend,
              purchaseRoas: roas,
              updatedTime: campaign.updatedTime,
            },
          });
        }
      }
    }

    if (isEnabled(config, PLAYBOOK_RULE_NO_DELIVERY)) {
      if (
        status === "ACTIVE" &&
        campaign.impressions === 0 &&
        campaign.spend === 0
      ) {
        candidates.push({
          ruleId: PLAYBOOK_RULE_NO_DELIVERY,
          severity: "warning",
          confidence: "medium",
          entityLevel: "campaign",
          entityId: campaign.id,
          entityName: campaign.name,
          actionType: "fix_delivery",
          title: "Campanha ativa sem entrega",
          evidence: `Campanha "${campaign.name}" está ACTIVE mas sem impressões/gasto nos últimos 30d.`,
          recommendation:
            "Checar saldo da conta, status dos anúncios (reprovação/WITH_ISSUES), orçamento restante e restrições de horário/público antes de criar campanha nova.",
          metrics: {
            impressions: campaign.impressions,
            spend: campaign.spend,
            effectiveStatus: status,
          },
        });
      }
    }
  }

  return {
    accountId: args.accountId,
    campaigns: args.campaigns,
    candidates,
  };
}
