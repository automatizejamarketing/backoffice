import {
  PLAYBOOK_DEFAULT_CPA_ALERT,
  PLAYBOOK_MIN_SPEND,
  PLAYBOOK_MIN_SPEND_STALLED,
  PLAYBOOK_ROAS_TRIGGER,
  PLAYBOOK_ROAS_VALIDATED,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_STALLED_DAYS,
} from "./constants";
import type {
  CampaignMetricsRow,
  CreativeDiagnosisPlaybookRow,
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

function parseTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A campaign is eligible when it was created on/after the current Meta
 * connection, or it spent anything in the trailing 10 calendar days.
 * Missing/invalid createdTime qualifies only through recent spend.
 * When no connection cutoff is provided, every campaign stays eligible.
 */
export function isPlaybookCampaignEligible(args: {
  campaign: Pick<CampaignMetricsRow, "createdTime" | "spendLast10Days">;
  connectionCreatedAt?: Date | null;
}): boolean {
  if (args.campaign.spendLast10Days > 0) return true;
  if (!args.connectionCreatedAt) return true;
  const createdAt = parseTimestamp(args.campaign.createdTime);
  const cutoff = parseTimestamp(args.connectionCreatedAt);
  if (createdAt === null || cutoff === null) return false;
  return createdAt >= cutoff;
}

function asDiagnosis(value: unknown): {
  likelyContributor: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  alternativeExplanations: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.likelyContributor !== "boolean") return null;
  if (
    record.confidence !== "high" &&
    record.confidence !== "medium" &&
    record.confidence !== "low"
  ) {
    return null;
  }
  if (typeof record.summary !== "string" || record.summary.trim() === "") {
    return null;
  }
  const alternatives = Array.isArray(record.alternativeExplanations)
    ? record.alternativeExplanations.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
  return {
    likelyContributor: record.likelyContributor,
    confidence: record.confidence,
    summary: record.summary.trim(),
    alternativeExplanations: alternatives,
  };
}

export function creativeDiagnosisCandidate(
  row: CreativeDiagnosisPlaybookRow,
  campaignNameById: ReadonlyMap<string, string>,
): PlaybookInsightCandidate | null {
  const parsed = asDiagnosis(row.diagnosis);
  if (!parsed) return null;
  if (parsed.confidence === "low") return null;

  const adName = row.adName?.trim() || row.adId;
  const campaignLabel =
    (row.campaignId && campaignNameById.get(row.campaignId)) ||
    row.campaignId ||
    "campanha";

  if (parsed.likelyContributor) {
    if (parsed.confidence !== "high") return null;
    return {
      ruleId: PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
      severity: "warning",
      confidence: "high",
      entityLevel: "ad",
      entityId: row.adId,
      entityName: adName,
      actionType: "review_creative",
      title: "Criativo pode estar pesando no resultado",
      evidence: `Anúncio "${adName}" (${campaignLabel}): ${parsed.summary}`,
      recommendation:
        "Tratar como uma hipótese entre outras. Conferir a peça (gancho, produto, CTA) e só então testar variação — não pausar por impulso.",
      metrics: {
        diagnosisId: row.id,
        adId: row.adId,
        campaignId: row.campaignId,
        likelyContributor: true,
        confidence: parsed.confidence,
      },
    };
  }

  const alternatives =
    parsed.alternativeExplanations.length > 0
      ? parsed.alternativeExplanations.join(" ")
      : "Oferta, público, tracking ou orçamento podem explicar o gap.";

  return {
    ruleId: PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
    severity: "info",
    confidence: parsed.confidence,
    entityLevel: "ad",
    entityId: row.adId,
    entityName: adName,
    actionType: "review_other_causes",
    title: "Criativo parece ok — investigar outra causa",
    evidence: `Anúncio "${adName}" (${campaignLabel}) está abaixo dos irmãos, mas a peça não parece o problema. ${parsed.summary}`,
    recommendation: alternatives,
    metrics: {
      diagnosisId: row.id,
      adId: row.adId,
      campaignId: row.campaignId,
      likelyContributor: false,
      confidence: parsed.confidence,
    },
  };
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
  connectionCreatedAt?: Date | null;
  creativeDiagnoses?: CreativeDiagnosisPlaybookRow[];
}): PlaybookEvaluationResult {
  const now = args.now ?? new Date();
  const config: PlaybookEvaluationConfig = {
    ...args.config,
    cpaAlertThreshold:
      args.config?.cpaAlertThreshold ?? args.cpaAlertThreshold,
  };
  const campaigns = args.campaigns.filter((campaign) =>
    isPlaybookCampaignEligible({
      campaign,
      connectionCreatedAt: args.connectionCreatedAt,
    }),
  );
  const candidates: PlaybookInsightCandidate[] = [];

  for (const campaign of campaigns) {
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

  if (isEnabled(config, PLAYBOOK_RULE_CREATIVE_DIAGNOSIS)) {
    const campaignNameById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign.name]),
    );
    for (const row of args.creativeDiagnoses ?? []) {
      const candidate = creativeDiagnosisCandidate(row, campaignNameById);
      if (candidate) candidates.push(candidate);
    }
  }

  return {
    accountId: args.accountId,
    campaigns,
    candidates,
  };
}
