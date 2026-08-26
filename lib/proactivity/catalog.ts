/**
 * Static catalog of proactivity alerts.
 * Rule logic/copy stay in code; only match values + channels are DB-configurable.
 */

export type ProactivityAudience = "client" | "consultant";

export type ThresholdFieldDef = {
  key: string;
  label: string;
  suffix?: string;
  min?: number;
  step?: number;
};

export type ProactivityAlertDefinition = {
  ruleKey: string;
  title: string;
  description: string;
  audience: ProactivityAudience;
  thresholdFields: ThresholdFieldDef[];
  defaultThresholds: Record<string, number>;
  /** Client proactive rule id (matches automatize-frontend rule.id). */
  clientRuleId?: string;
  /** Consultant playbook rule id (playbook.*). */
  playbookRuleId?: string;
};

const numberField = (
  key: string,
  label: string,
  opts?: { suffix?: string; min?: number; step?: number },
): ThresholdFieldDef => ({
  key,
  label,
  suffix: opts?.suffix,
  min: opts?.min ?? 0,
  step: opts?.step ?? 1,
});

export const PROACTIVITY_ALERT_DEFINITIONS: readonly ProactivityAlertDefinition[] =
  [
    // —— Consultant (playbook) ——
    {
      ruleKey: "roas_trigger",
      title: "ROAS baixo — acionar análise",
      description:
        "Campanha ativa com ROAS abaixo do limite e gasto mínimo nos últimos 30d.",
      audience: "consultant",
      playbookRuleId: "playbook.roas_trigger",
      thresholdFields: [
        numberField("minSpend", "Gasto mínimo", { suffix: "R$" }),
        numberField("roasTrigger", "ROAS máximo (alerta)", { step: 0.1 }),
      ],
      defaultThresholds: { minSpend: 50, roasTrigger: 3 },
    },
    {
      ruleKey: "roas_scale",
      title: "ROAS validado — oportunidade de escala",
      description:
        "Campanha com ROAS alto o suficiente para sugerir escala ou duplicação.",
      audience: "consultant",
      playbookRuleId: "playbook.roas_scale",
      thresholdFields: [
        numberField("minSpend", "Gasto mínimo", { suffix: "R$" }),
        numberField("roasValidated", "ROAS mínimo (escala)", { step: 0.1 }),
      ],
      defaultThresholds: { minSpend: 50, roasValidated: 5 },
    },
    {
      ruleKey: "cpa_alert",
      title: "CPA acima do alerta",
      description: "Campanha ativa com CPA acima do limite configurado.",
      audience: "consultant",
      playbookRuleId: "playbook.cpa_alert",
      thresholdFields: [
        numberField("minSpend", "Gasto mínimo", { suffix: "R$" }),
        numberField("cpaAlert", "CPA alerta", { suffix: "R$", step: 0.1 }),
      ],
      defaultThresholds: { minSpend: 50, cpaAlert: 7.5 },
    },
    {
      ruleKey: "campaign_stalled",
      title: "Campanha parada (consultor)",
      description:
        "Campanha pausada há vários dias com gasto histórico relevante.",
      audience: "consultant",
      playbookRuleId: "playbook.campaign_stalled",
      thresholdFields: [
        numberField("stalledPausedDays", "Dias pausada", { suffix: "dias", min: 1 }),
        numberField("minSpendForStalled", "Gasto mínimo", { suffix: "R$" }),
      ],
      defaultThresholds: { stalledPausedDays: 5, minSpendForStalled: 30 },
    },
    {
      ruleKey: "no_delivery",
      title: "Campanha ativa sem entrega",
      description:
        "Campanha ACTIVE sem impressões/gasto — sem limiares numéricos além do status.",
      audience: "consultant",
      playbookRuleId: "playbook.no_delivery",
      thresholdFields: [],
      defaultThresholds: {},
    },
    {
      ruleKey: "creative_diagnosis",
      title: "Diagnóstico de criativo (consultor)",
      description:
        "Anúncio com métricas fracas vs irmãos: o criativo pode estar pesando, ou a peça parece ok e a causa é outra (oferta, público, tracking).",
      audience: "consultant",
      playbookRuleId: "playbook.creative_diagnosis",
      thresholdFields: [],
      defaultThresholds: {},
    },

    // —— Client (proactive signals) ——
    {
      ruleKey: "low_ad_balance",
      title: "Saldo de anúncios baixo",
      description:
        "Saldo da conta com poucos dias de runway ou abaixo do piso absoluto.",
      audience: "client",
      clientRuleId: "low_ad_balance",
      thresholdFields: [
        numberField("balanceRunwayDays", "Dias de runway", { suffix: "dias", min: 1 }),
        numberField("minAvgDailySpendForRunway", "Gasto diário mínimo", {
          suffix: "R$",
        }),
        numberField("lowBalanceAbsoluteFloor", "Piso absoluto", { suffix: "R$" }),
      ],
      defaultThresholds: {
        balanceRunwayDays: 3,
        minAvgDailySpendForRunway: 5,
        lowBalanceAbsoluteFloor: 50,
      },
    },
    {
      ruleKey: "campaign_ended_good_roas",
      title: "Campanha encerrou com bom ROAS",
      description: "Sugestão de duplicar campanha encerrada com bom ROAS.",
      audience: "client",
      clientRuleId: "campaign_ended_good_roas",
      thresholdFields: [
        numberField("goodRoasInfo", "ROAS mínimo (info)", { step: 0.1 }),
        numberField("goodRoasOpportunity", "ROAS oportunidade", { step: 0.1 }),
        numberField("minSpendForRoasSignal", "Gasto mínimo", { suffix: "R$" }),
      ],
      defaultThresholds: {
        goodRoasInfo: 2,
        goodRoasOpportunity: 5,
        minSpendForRoasSignal: 50,
      },
    },
    {
      ruleKey: "high_roas_opportunity",
      title: "Alta oportunidade de ROAS",
      description: "Campanha ativa com ROAS excelente para reforçar.",
      audience: "client",
      clientRuleId: "high_roas_opportunity",
      thresholdFields: [
        numberField("goodRoasOpportunity", "ROAS mínimo", { step: 0.1 }),
        numberField("minSpendForRoasSignal", "Gasto mínimo", { suffix: "R$" }),
      ],
      defaultThresholds: {
        goodRoasOpportunity: 5,
        minSpendForRoasSignal: 50,
      },
    },
    {
      ruleKey: "campaign_stalled",
      title: "Campanha parada (cliente)",
      description: "Campanha pausada há vários dias — sugerir reativação.",
      audience: "client",
      clientRuleId: "campaign_stalled",
      thresholdFields: [
        numberField("stalledPausedDays", "Dias pausada", { suffix: "dias", min: 1 }),
        numberField("minSpendForStalled", "Gasto mínimo", { suffix: "R$" }),
      ],
      defaultThresholds: { stalledPausedDays: 5, minSpendForStalled: 30 },
    },
    {
      ruleKey: "creative_fatigue",
      title: "Fadiga de criativo",
      description: "Anúncio com frequência alta ou queda de CTR.",
      audience: "client",
      clientRuleId: "creative_fatigue",
      thresholdFields: [
        numberField("creativeMinAgeDays", "Idade mínima", { suffix: "dias", min: 1 }),
        numberField("creativeFatigueFrequency", "Frequência", { step: 0.1 }),
        numberField("creativeCtrDropRatio", "Queda de CTR", { step: 0.01 }),
        numberField("creativeMinImpressions7d", "Impressões mín. 7d", { min: 1 }),
      ],
      defaultThresholds: {
        creativeMinAgeDays: 7,
        creativeFatigueFrequency: 3.5,
        creativeCtrDropRatio: 0.35,
        creativeMinImpressions7d: 1000,
      },
    },
    {
      ruleKey: "pixel_no_events",
      title: "Pixel sem eventos",
      description: "Pixel sem disparos recentes.",
      audience: "client",
      clientRuleId: "pixel_no_events",
      thresholdFields: [
        numberField("pixelStaleDays", "Dias sem evento", { suffix: "dias", min: 1 }),
      ],
      defaultThresholds: { pixelStaleDays: 3 },
    },
    {
      ruleKey: "delivery_issue",
      title: "Problema de entrega",
      description:
        "Anúncio ACTIVE sem impressões ou PENDING_REVIEW há tempo demais.",
      audience: "client",
      clientRuleId: "delivery_issue",
      thresholdFields: [
        numberField("deliveryZeroImpressionHours", "Horas sem impressão", {
          suffix: "h",
          min: 1,
        }),
        numberField("pendingReviewMaxHours", "Horas em revisão", {
          suffix: "h",
          min: 1,
        }),
      ],
      defaultThresholds: {
        deliveryZeroImpressionHours: 24,
        pendingReviewMaxHours: 48,
      },
    },
  ];

export function getAlertDefinition(
  ruleKey: string,
  audience: ProactivityAudience,
): ProactivityAlertDefinition | undefined {
  return PROACTIVITY_ALERT_DEFINITIONS.find(
    (def) => def.ruleKey === ruleKey && def.audience === audience,
  );
}

export function validateAlertChannels(args: {
  audience: ProactivityAudience;
  deliverWhatsapp: boolean;
  deliverSlack: boolean;
}): void {
  if (args.audience === "client" && args.deliverSlack) {
    throw new Error("invalid_deliver_slack_for_client");
  }
  if (args.audience === "consultant" && args.deliverWhatsapp) {
    throw new Error("invalid_deliver_whatsapp_for_consultant");
  }
}

export function validateAlertThresholds(
  definition: ProactivityAlertDefinition,
  thresholds: Record<string, unknown>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of definition.thresholdFields) {
    const raw = thresholds[field.key];
    const value =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw)
          : Number.NaN;
    if (!Number.isFinite(value)) {
      throw new Error(`invalid_threshold_${field.key}`);
    }
    if (field.min !== undefined && value < field.min) {
      throw new Error(`invalid_threshold_${field.key}_min`);
    }
    result[field.key] = value;
  }
  // Reject unknown keys that are not in the schema
  for (const key of Object.keys(thresholds)) {
    if (!definition.thresholdFields.some((field) => field.key === key)) {
      throw new Error(`unknown_threshold_${key}`);
    }
  }
  return result;
}

export function seedRowsFromCatalog(): Array<{
  ruleKey: string;
  audience: ProactivityAudience;
  enabled: boolean;
  thresholds: Record<string, number>;
  deliverWhatsapp: boolean;
  deliverSlack: boolean;
}> {
  return PROACTIVITY_ALERT_DEFINITIONS.map((def) => ({
    ruleKey: def.ruleKey,
    audience: def.audience,
    enabled: true,
    thresholds: { ...def.defaultThresholds },
    deliverWhatsapp: false,
    deliverSlack: false,
  }));
}
