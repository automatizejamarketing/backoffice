const PURCHASE_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
  "omni_purchase",
  "purchase",
] as const;

type ActionRow = { action_type?: string; value?: string };

export type InsightMetrics = {
  spend: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
  impressions: number;
  clicks: number;
  dateStart: string | null;
  dateStop: string | null;
};

export type RawInsight = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: ActionRow[];
  action_values?: ActionRow[];
  cost_per_action_type?: ActionRow[];
  purchase_roas?: ActionRow[];
  website_purchase_roas?: ActionRow[];
  date_start?: string;
  date_stop?: string;
};

export function parseNumber(value: string | undefined | null): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

function pickActionValue(rows: ActionRow[] | undefined): number {
  if (!rows?.length) return 0;
  for (const type of PURCHASE_ACTION_TYPES) {
    const hit = rows.find((row) => row.action_type === type);
    if (hit) return parseNumber(hit.value);
  }
  return 0;
}

function pickRoas(
  purchaseRoas: ActionRow[] | undefined,
  websiteRoas: ActionRow[] | undefined,
): number | null {
  for (const type of PURCHASE_ACTION_TYPES) {
    const hit = purchaseRoas?.find((row) => row.action_type === type);
    if (hit) {
      const n = parseNumber(hit.value);
      return n > 0 ? n : null;
    }
  }
  const first =
    purchaseRoas?.[0]?.value ??
    websiteRoas?.find((row) => row.action_type === "omni_purchase")?.value ??
    websiteRoas?.[0]?.value;
  if (!first) return null;
  const n = parseNumber(first);
  return n > 0 ? n : null;
}

export function metricsFromInsight(
  insight: RawInsight | undefined,
): InsightMetrics {
  const spend = parseNumber(insight?.spend);
  const purchases = pickActionValue(insight?.actions);
  let purchaseValue = pickActionValue(insight?.action_values);
  let roas = pickRoas(insight?.purchase_roas, insight?.website_purchase_roas);

  if (purchaseValue <= 0 && spend > 0 && roas !== null) {
    purchaseValue = roas * spend;
  }
  if (roas === null && spend > 0 && purchaseValue > 0) {
    roas = purchaseValue / spend;
  }

  const cpaFromMeta = pickActionValue(insight?.cost_per_action_type);
  const cpa =
    cpaFromMeta > 0 ? cpaFromMeta : purchases > 0 ? spend / purchases : null;

  return {
    spend,
    purchases,
    purchaseValue,
    cpa: cpa !== null && Number.isFinite(cpa) ? cpa : null,
    roas: roas !== null && Number.isFinite(roas) ? roas : null,
    impressions: parseNumber(insight?.impressions),
    clicks: parseNumber(insight?.clicks),
    dateStart: insight?.date_start ?? null,
    dateStop: insight?.date_stop ?? null,
  };
}
