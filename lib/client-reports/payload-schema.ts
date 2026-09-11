export const CLIENT_REPORT_PAYLOAD_VERSION = "v1" as const;

export type ClientReportHeadlineState = "good" | "neutral" | "bad";
export type ClientReportPeriodType = "weekly" | "monthly" | "cycle";

export type ClientReportDelta = {
  spend: number | null;
  purchaseValue: number | null;
  netReturn: number | null;
  roasAdjusted: number | null;
};

export type ClientReportCampaignCard = {
  id: string;
  name: string;
  spend: number;
  purchaseValue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
};

export type ClientReportCreativeCard = {
  adId: string;
  name: string | null;
  summary: string;
  craftGaps: string[];
  likelyContributor: boolean;
  purchaseValue: number | null;
};

export type ClientReportAction = {
  title: string;
  message: string;
  actionPrompt: string | null;
  deepLink: string;
  estimatedWeeklyRevenue: number | null;
};

export type ClientReportOutcome = {
  action: string;
  result: string;
};

export type ClientReportPayloadV1 = {
  schemaVersion: typeof CLIENT_REPORT_PAYLOAD_VERSION;
  period: {
    type: ClientReportPeriodType;
    start: string;
    end: string;
    windowDays: number;
  };
  headline: {
    state: ClientReportHeadlineState;
    title: string;
    subtitle: string;
  };
  scorecard: {
    spend: number;
    purchaseValue: number;
    purchases: number;
    netReturn: number | null;
    roasMeta: number | null;
    roasAdjusted: number | null;
    planCostAllocated: number | null;
    impressions: number;
    clicks: number;
    delta: ClientReportDelta;
  };
  paidBack: {
    months: number | null;
    visible: boolean;
    monthlyPlanPrice: number | null;
    cumulativeNetReturn: number | null;
    daysOfData: number;
    expirationDate: string | null;
  };
  campaigns: {
    best: ClientReportCampaignCard[];
    needsAttention: ClientReportCampaignCard[];
  };
  creatives: ClientReportCreativeCard[];
  actions: ClientReportAction[];
  missions: Array<{
    id: string;
    title: string;
    status: "suggested" | "started" | "done" | "skipped";
  }>;
  workThisWeek: {
    changeEvents: number;
    diagnoses: number;
    alerts: number;
  };
  outcomes: ClientReportOutcome[];
  streak: {
    weeks: number;
    frozen: boolean;
  };
  benchmark: {
    spendBucket: string;
    sampleSize: number;
    percentile: number | null;
    label: string;
  } | null;
  methodology: {
    attributionLabel: string;
    windowLabel: string;
  };
};

export function isClientReportPayloadV1(
  value: unknown,
): value is ClientReportPayloadV1 {
  if (!value || typeof value !== "object") return false;
  const row = value as { schemaVersion?: unknown };
  return row.schemaVersion === CLIENT_REPORT_PAYLOAD_VERSION;
}

export function emptyPayload(
  period: ClientReportPayloadV1["period"],
): ClientReportPayloadV1 {
  return {
    schemaVersion: CLIENT_REPORT_PAYLOAD_VERSION,
    period,
    headline: {
      state: "neutral",
      title: "Seu resumo da semana",
      subtitle: "Ainda não há vendas atribuídas aos anúncios neste período.",
    },
    scorecard: {
      spend: 0,
      purchaseValue: 0,
      purchases: 0,
      netReturn: null,
      roasMeta: null,
      roasAdjusted: null,
      planCostAllocated: null,
      impressions: 0,
      clicks: 0,
      delta: {
        spend: null,
        purchaseValue: null,
        netReturn: null,
        roasAdjusted: null,
      },
    },
    paidBack: {
      months: null,
      visible: false,
      monthlyPlanPrice: null,
      cumulativeNetReturn: null,
      daysOfData: period.windowDays,
      expirationDate: null,
    },
    campaigns: { best: [], needsAttention: [] },
    creatives: [],
    actions: [],
    missions: [],
    workThisWeek: { changeEvents: 0, diagnoses: 0, alerts: 0 },
    outcomes: [],
    streak: { weeks: 0, frozen: false },
    benchmark: null,
    methodology: {
      attributionLabel:
        "Vendas atribuídas pela Meta aos anúncios (pixel de compra).",
      windowLabel: `${period.start} a ${period.end}`,
    },
  };
}

export function headlineForState(input: {
  state: ClientReportHeadlineState;
  purchaseValue: number;
  netReturn: number | null;
  monthsPaidBack: number | null;
}): { title: string; subtitle: string } {
  const sales = formatReais(input.purchaseValue);
  if (input.state === "good") {
    const months = input.monthsPaidBack;
    const subtitle =
      months !== null && months >= 1
        ? `Esse retorno já cobriu cerca de ${months.toFixed(1)} ${
            months >= 2 ? "meses" : "mês"
          } de Automatize.`
        : `Vendas atribuídas aos anúncios: ${sales}.`;
    return {
      title: "Semana com retorno positivo",
      subtitle,
    };
  }
  if (input.state === "bad") {
    return {
      title: "Semana para ajustar",
      subtitle:
        "Os anúncios não pagaram o investimento. Abaixo está o que vale fazer agora.",
    };
  }
  return {
    title: "Resumo da sua operação",
    subtitle:
      input.purchaseValue > 0
        ? `Vendas atribuídas aos anúncios: ${sales}.`
        : "Ainda não há compras atribuídas pelo pixel neste período.",
  };
}

export function formatReais(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

export function resolveHeadlineState(input: {
  roasAdjusted: number | null;
  purchaseValue: number;
  spend: number;
}): ClientReportHeadlineState {
  if (input.roasAdjusted !== null && input.roasAdjusted >= 2) return "good";
  if (input.purchaseValue > 0 && input.spend > 0 && input.roasAdjusted !== null) {
    if (input.roasAdjusted >= 1) return "good";
    return "bad";
  }
  if (input.spend > 0 && input.purchaseValue === 0) return "bad";
  return "neutral";
}

export function computeMonthsPaidBack(input: {
  cumulativeNetReturn: number | null;
  monthlyPlanPrice: number | null;
  daysOfData: number;
  roasAdjusted: number | null;
  purchases: number;
}): { months: number | null; visible: boolean } {
  if (
    input.monthlyPlanPrice === null ||
    !(input.monthlyPlanPrice > 0) ||
    input.cumulativeNetReturn === null ||
    input.cumulativeNetReturn <= 0 ||
    input.daysOfData < 30 ||
    input.purchases <= 0 ||
    input.roasAdjusted === null ||
    input.roasAdjusted < 1
  ) {
    return { months: null, visible: false };
  }
  return {
    months: input.cumulativeNetReturn / input.monthlyPlanPrice,
    visible: true,
  };
}

export function spendBucket(spend: number): string {
  if (spend < 500) return "0-500";
  if (spend < 1500) return "500-1500";
  if (spend < 4000) return "1500-4000";
  return "4000+";
}

export function percentileRank(value: number, median: number): number | null {
  if (!(median > 0) || !(value > 0)) return null;
  const ratio = value / median;
  const percentile = Math.round(50 * ratio);
  return Math.min(99, Math.max(1, percentile));
}
