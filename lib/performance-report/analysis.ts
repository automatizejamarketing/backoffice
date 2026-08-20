/**
 * HUD-parity campaign classification and consultant report math.
 * Delivery comes from Meta `effective_status` (+ elapsed stop_time), never from
 * the operational toggle (`status`).
 */

export const HUD_CAMPAIGN_EFFECTIVE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "WITH_ISSUES",
  "IN_PROCESS",
] as const;

export const HUD_AD_EFFECTIVE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "WITH_ISSUES",
  "IN_PROCESS",
] as const;

export const HUD_DELIVERIES = [
  "active",
  "pending",
  "inactive",
  "completed",
] as const;

export type HudDelivery = (typeof HUD_DELIVERIES)[number];

export const ANALYTICAL_TAGS = ["ATIVA", "PAUSADA", "EM ANÁLISE"] as const;

export type AnalyticalTag = (typeof ANALYTICAL_TAGS)[number];

export const SAMPLE_CAVEATS = ["robust", "moderate", "limited"] as const;

export type SampleCaveat = (typeof SAMPLE_CAVEATS)[number];

const PENDING_EFFECTIVE = new Set([
  "PENDING_REVIEW",
  "IN_PROCESS",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
]);

const EXCLUDED_EFFECTIVE = new Set(["DELETED", "ARCHIVED"]);

const LIMITED_PURCHASES = 3;
const LIMITED_SPEND = 100;
const ROBUST_PURCHASES = 10;
const ROBUST_SPEND = 300;

const DATE_PRESET_DAYS: Record<string, number> = {
  today: 1,
  yesterday: 1,
  last_7d: 7,
  last_14d: 14,
  last_30d: 30,
};

export function normalizeCurrency(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function isHudVisibleCampaign(
  effectiveStatus: string | null | undefined,
): boolean {
  const normalized = effectiveStatus?.toUpperCase() ?? "";
  if (EXCLUDED_EFFECTIVE.has(normalized)) return false;
  return (HUD_CAMPAIGN_EFFECTIVE_STATUSES as readonly string[]).includes(
    normalized,
  );
}

/**
 * Mirrors product `getDeliveryStatus`: stop_time in the past is Concluído even
 * when Graph still reports effective_status=ACTIVE. Toggle `status` is ignored.
 */
export function mapHudDelivery(
  effectiveStatus: string | null | undefined,
  stopTime?: string | null,
  now: number = Date.now(),
): HudDelivery {
  if (!effectiveStatus) {
    return "inactive";
  }

  const normalized = effectiveStatus.toUpperCase();
  if (EXCLUDED_EFFECTIVE.has(normalized)) {
    return "inactive";
  }

  if (stopTime) {
    const end = new Date(stopTime);
    if (!Number.isNaN(end.getTime()) && end.getTime() <= now) {
      return "completed";
    }
  }

  if (normalized === "ACTIVE") {
    return "active";
  }
  if (PENDING_EFFECTIVE.has(normalized)) {
    return "pending";
  }
  return "inactive";
}

export function analyticalTagFromDelivery(delivery: HudDelivery): AnalyticalTag {
  if (delivery === "active") return "ATIVA";
  if (delivery === "pending") return "EM ANÁLISE";
  return "PAUSADA";
}

export function hudDeliveryLabel(delivery: HudDelivery): string {
  switch (delivery) {
    case "active":
      return "Ativo";
    case "pending":
      return "Pendente";
    case "completed":
      return "Concluído";
    default:
      return "Inativo";
  }
}

export type SortableCampaign = {
  startTime?: string | null;
  createdTime?: string | null;
  name?: string | null;
};

export function campaignStartMs(campaign: SortableCampaign): number {
  const raw = campaign.startTime || campaign.createdTime;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest start date first. Never sort by ROAS, spend, purchases, or CPA. */
export function sortCampaignsNewestFirst<T extends SortableCampaign>(
  campaigns: T[],
): T[] {
  return [...campaigns].sort((a, b) => {
    const delta = campaignStartMs(b) - campaignStartMs(a);
    if (delta !== 0) return delta;
    return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
  });
}

export function calendarDaysInclusive(
  start: string | null | undefined,
  stop: string | null | undefined,
): number | null {
  const from = start?.slice(0, 10);
  const to = stop?.slice(0, 10);
  if (!from || !to) return null;
  const [sy, sm, sd] = from.split("-").map(Number);
  const [ey, em, ed] = to.split("-").map(Number);
  if (!(sy && sm && sd && ey && em && ed)) return null;
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const days = Math.round((endUtc - startUtc) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

/**
 * Whole calendar days in a half-open interval [start, end).
 * Billing providers expose current_period_end as an exclusive boundary.
 */
export function calendarDaysExclusive(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const from = start?.slice(0, 10);
  const to = end?.slice(0, 10);
  if (!from || !to) return null;
  const [sy, sm, sd] = from.split("-").map(Number);
  const [ey, em, ed] = to.split("-").map(Number);
  if (!(sy && sm && sd && ey && em && ed)) return null;
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const days = Math.round((endUtc - startUtc) / 86_400_000);
  return days > 0 ? days : null;
}

export function windowDays(input: {
  dateStart?: string | null;
  dateStop?: string | null;
  datePreset?: string | null;
}): number {
  const fromDates = calendarDaysInclusive(input.dateStart, input.dateStop);
  if (fromDates) return fromDates;
  const preset = input.datePreset?.trim() ?? "";
  return DATE_PRESET_DAYS[preset] ?? 30;
}

export function billingCycleDays(input: {
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  commitmentMonths?: number | null;
}): number {
  const start =
    input.periodStart instanceof Date
      ? input.periodStart.toISOString()
      : input.periodStart;
  const end =
    input.periodEnd instanceof Date
      ? input.periodEnd.toISOString()
      : input.periodEnd;
  const fromDates = calendarDaysExclusive(start, end);
  if (fromDates) return fromDates;
  const months = input.commitmentMonths;
  if (typeof months === "number" && months > 0) {
    return months * 30;
  }
  return 30;
}

export function paymentAmountReais(amountCentavos: number): number {
  return amountCentavos / 100;
}

export function allocatePlanCost(input: {
  planAmountReais: number;
  billingCycleDays: number;
  windowDays: number;
}): number | null {
  if (!(input.planAmountReais > 0)) return null;
  if (!(input.billingCycleDays > 0)) return null;
  if (!(input.windowDays > 0)) return null;
  // The standard consultant report is exactly 30 days and uses one full
  // monthly payment. Only non-standard windows are prorated.
  if (input.windowDays === 30) return input.planAmountReais;
  return input.planAmountReais * (input.windowDays / input.billingCycleDays);
}

export const ADJUSTED_ROAS_UNAVAILABLE = [
  "missing_payment",
  "zero_spend",
  "currency_mismatch",
  "missing_billing_cycle",
  "invalid_plan_cost",
] as const;

export type AdjustedRoasUnavailable =
  (typeof ADJUSTED_ROAS_UNAVAILABLE)[number];

export type RoasPair = {
  roasMeta: number | null;
  roasAdjusted: number | null;
  allocatedPlanCost: number | null;
  totalCost: number | null;
  unavailableReason: AdjustedRoasUnavailable | null;
};

function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function computeRoasPair(input: {
  purchaseValue: number;
  spend: number;
  allocatedPlanCost: number | null;
  spendCurrency?: string | null;
  planCurrency?: string | null;
  hasPayment: boolean;
}): RoasPair {
  const roasMeta = ratio(input.purchaseValue, input.spend);

  if (!input.hasPayment) {
    return {
      roasMeta,
      roasAdjusted: null,
      allocatedPlanCost: null,
      totalCost: null,
      unavailableReason: "missing_payment",
    };
  }
  if (!(input.spend > 0)) {
    return {
      roasMeta,
      roasAdjusted: null,
      allocatedPlanCost: input.allocatedPlanCost,
      totalCost: null,
      unavailableReason: "zero_spend",
    };
  }
  const spendCurrency = normalizeCurrency(input.spendCurrency);
  const planCurrency = normalizeCurrency(input.planCurrency);
  if (!spendCurrency || !planCurrency || spendCurrency !== planCurrency) {
    return {
      roasMeta,
      roasAdjusted: null,
      allocatedPlanCost: input.allocatedPlanCost,
      totalCost: null,
      unavailableReason: "currency_mismatch",
    };
  }
  if (input.allocatedPlanCost === null) {
    return {
      roasMeta,
      roasAdjusted: null,
      allocatedPlanCost: null,
      totalCost: null,
      unavailableReason: "missing_billing_cycle",
    };
  }
  if (!(input.allocatedPlanCost >= 0)) {
    return {
      roasMeta,
      roasAdjusted: null,
      allocatedPlanCost: null,
      totalCost: null,
      unavailableReason: "invalid_plan_cost",
    };
  }

  const totalCost = input.spend + input.allocatedPlanCost;
  return {
    roasMeta,
    roasAdjusted: ratio(input.purchaseValue, totalCost),
    allocatedPlanCost: input.allocatedPlanCost,
    totalCost,
    unavailableReason: null,
  };
}

export function sampleCaveat(input: {
  spend: number;
  purchases: number;
}): SampleCaveat {
  if (input.purchases < LIMITED_PURCHASES || input.spend < LIMITED_SPEND) {
    return "limited";
  }
  if (input.purchases >= ROBUST_PURCHASES && input.spend >= ROBUST_SPEND) {
    return "robust";
  }
  return "moderate";
}

export function sampleCaveatLabel(caveat: SampleCaveat): string {
  switch (caveat) {
    case "robust":
      return "conclusão robusta";
    case "limited":
      return "conclusão limitada pelo tamanho da amostra";
    default:
      return "conclusão moderada — amostra ainda pequena";
  }
}

export type MetricTotals = {
  spend: number;
  purchases: number;
  purchaseValue: number;
  impressions: number;
  clicks: number;
};

export function emptyMetricTotals(): MetricTotals {
  return {
    spend: 0,
    purchases: 0,
    purchaseValue: 0,
    impressions: 0,
    clicks: 0,
  };
}

export function addMetricTotals(
  acc: MetricTotals,
  row: Partial<MetricTotals>,
): MetricTotals {
  return {
    spend: acc.spend + (row.spend ?? 0),
    purchases: acc.purchases + (row.purchases ?? 0),
    purchaseValue: acc.purchaseValue + (row.purchaseValue ?? 0),
    impressions: acc.impressions + (row.impressions ?? 0),
    clicks: acc.clicks + (row.clicks ?? 0),
  };
}

export function derivedCpa(totals: MetricTotals): number | null {
  return ratio(totals.spend, totals.purchases);
}

export function derivedRoas(totals: MetricTotals): number | null {
  return ratio(totals.purchaseValue, totals.spend);
}

export type CreativeInsightInput = {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  creativeId: string | null;
  creativeName: string | null;
  spend: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
};

export type GroupedCreative = {
  key: string;
  creativeId: string | null;
  name: string;
  campaignIds: string[];
  campaignNames: string[];
  spend: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
  sampleCaveat: SampleCaveat;
};

export function groupCreatives(
  ads: CreativeInsightInput[],
): GroupedCreative[] {
  const groups = new Map<string, CreativeInsightInput[]>();
  for (const ad of ads) {
    const key = ad.creativeId || ad.id;
    const current = groups.get(key) ?? [];
    current.push(ad);
    groups.set(key, current);
  }

  const grouped: GroupedCreative[] = [];
  for (const [key, rows] of groups) {
    const totals = rows.reduce(
      (acc, row) => addMetricTotals(acc, row),
      emptyMetricTotals(),
    );
    const campaignIds = [
      ...new Set(rows.map((row) => row.campaignId).filter(Boolean)),
    ] as string[];
    const campaignNames = [
      ...new Set(rows.map((row) => row.campaignName).filter(Boolean)),
    ] as string[];
    const first = rows[0];
    grouped.push({
      key,
      creativeId: first?.creativeId ?? null,
      name: first?.creativeName || first?.name || key,
      campaignIds,
      campaignNames,
      spend: totals.spend,
      purchases: totals.purchases,
      purchaseValue: totals.purchaseValue,
      cpa: derivedCpa(totals),
      roas: derivedRoas(totals),
      sampleCaveat: sampleCaveat(totals),
    });
  }

  return grouped.sort((a, b) => {
    const roasDelta = (b.roas ?? -1) - (a.roas ?? -1);
    if (roasDelta !== 0) return roasDelta;
    return b.spend - a.spend;
  });
}

export const ACCOUNT_TOTALS_ORDER = [
  "gasto",
  "compras",
  "valorDeCompra",
  "cpa",
  "roasMeta",
  "roasAjustado",
  "impressoes",
  "cliques",
] as const;

export const CAMPAIGN_METRICS_ORDER = [
  "roas",
  "valorDeCompra",
  "compras",
  "cpa",
  "gasto",
] as const;

export const CREATIVE_METRICS_ORDER = [
  "roas",
  "cpa",
  "gasto",
  "compras",
] as const;

export const ADJUSTED_ROAS_REASONS: Record<AdjustedRoasUnavailable, string> = {
  missing_payment:
    "Sem pagamento de plano sucedido no período; ROAS Ajustado indisponível.",
  zero_spend:
    "Gasto Meta zerado; ROAS Ajustado não é calculado sem mídia no período.",
  currency_mismatch:
    "Moeda da conta Meta diferente da moeda do plano; ROAS Ajustado indisponível.",
  missing_billing_cycle:
    "Não foi possível alocar o custo do plano à janela; ROAS Ajustado indisponível.",
  invalid_plan_cost:
    "Custo do plano inválido; ROAS Ajustado indisponível.",
};
