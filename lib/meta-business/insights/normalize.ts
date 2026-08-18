/**
 * Generic insights normalizer.
 *
 * Flattens a raw Graph insights row into numbers the model can reason over:
 * base metrics, the objective-aware result (count / cost-per-result / value /
 * ROAS), validated extra metrics, and breakdown dimension keys. Replaces the
 * narrow, per-route `transformInsights` (which only handled a fixed action set)
 * with a catalog-driven extractor (design §3, §6).
 *
 * Monetary insight fields are already in MAJOR units (see ./currency) — not
 * divided by 100 here.
 */
import type { GraphApiInsights } from "@/lib/meta-business/types";
import { resolveObjectiveResult } from "./catalogs/objectives";
import { getMetricSpec, type MetricSpec } from "./catalogs/metrics";
import { round2, toNumber } from "./currency";

/** Raw row may carry arbitrary breakdown/extra fields beyond GraphApiInsights. */
export type RawInsight = GraphApiInsights & Record<string, unknown>;

type ActionArray = Array<{ action_type?: string; value?: string }> | undefined;

export type NormalizedResult = {
  label: string;
  /** Which action_type matched, or null for reach / no result. */
  actionType: string | null;
  count: number | null;
  costPerResult: number | null;
  /** Monetary value of the result (sales objectives). */
  value: number | null;
  roas: number | null;
};

export type NormalizedInsight = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  frequency: number | null;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  cpp: number | null;
  result: NormalizedResult;
  /** Validated extra metrics, keyed by field name. */
  extras: Record<string, number | null>;
  /** Breakdown dimension → bucket value (only present when breakdowns requested). */
  breakdowns?: Record<string, string>;
  dateStart?: string;
  dateStop?: string;
  /** Account currency code (e.g. "BRL") so the agent shows the right symbol. */
  currency: string;
};

export type NormalizeOptions = {
  objective?: string | null;
  /** Specs for the extra metrics that were actually requested. */
  extraSpecs?: MetricSpec[];
  /** Active breakdown dimension names (raw keys present on the row). */
  breakdowns?: string[];
  currency: string;
};

function firstActionValue(arr: ActionArray, actionTypes: string[]): {
  actionType: string | null;
  value: number | null;
} {
  if (!arr?.length) return { actionType: null, value: null };
  for (const wanted of actionTypes) {
    const match = arr.find((a) => a.action_type === wanted);
    if (match) return { actionType: wanted, value: toNumber(match.value) };
  }
  return { actionType: null, value: null };
}

function valueForActionType(arr: ActionArray, actionType: string | null): number | null {
  if (!arr?.length || !actionType) return null;
  const match = arr.find((a) => a.action_type === actionType);
  return match ? toNumber(match.value) : null;
}

function firstAnyValue(arr: ActionArray): number | null {
  const found = arr?.find((a) => a.value != null);
  return found ? toNumber(found.value) : null;
}

function sumActionArray(arr: ActionArray): number | null {
  if (!arr?.length) return null;
  let sum = 0;
  let any = false;
  for (const a of arr) {
    const n = toNumber(a.value);
    if (n != null) {
      sum += n;
      any = true;
    }
  }
  return any ? round2(sum) : null;
}

function extractResult(raw: RawInsight, objective?: string | null): NormalizedResult {
  const def = resolveObjectiveResult(objective);

  if (def.kind === "reach") {
    return {
      label: def.labelPt,
      actionType: null,
      count: toNumber(raw.reach),
      costPerResult: null,
      value: null,
      roas: null,
    };
  }

  const { actionType, value: count } = firstActionValue(raw.actions, def.actionTypes);

  const costPerResult =
    valueForActionType(raw.cost_per_action_type, actionType) ??
    firstAnyValue(raw.cost_per_result) ??
    firstAnyValue(raw.cost_per_objective_result);

  const value = def.hasValue
    ? valueForActionType(raw.action_values, actionType)
    : null;

  const roas = def.hasValue
    ? (firstAnyValue(raw.purchase_roas) ?? firstAnyValue(raw.website_purchase_roas))
    : null;

  return {
    label: def.labelPt,
    actionType,
    count,
    costPerResult: round2(costPerResult),
    value: round2(value),
    roas: round2(roas),
  };
}

/** Normalize one raw insights row into flat numbers. */
export function normalizeInsightRow(
  raw: RawInsight,
  options: NormalizeOptions,
): NormalizedInsight {
  const extras: Record<string, number | null> = {};
  for (const spec of options.extraSpecs ?? []) {
    const value = raw[spec.field];
    extras[spec.field] = spec.isActionArray
      ? sumActionArray(value as ActionArray)
      : round2(toNumber(value as string | number | null | undefined));
  }

  let breakdowns: Record<string, string> | undefined;
  if (options.breakdowns?.length) {
    breakdowns = {};
    for (const dim of options.breakdowns) {
      const v = raw[dim];
      if (v != null) breakdowns[dim] = String(v);
    }
  }

  return {
    spend: round2(toNumber(raw.spend)),
    impressions: toNumber(raw.impressions),
    clicks: toNumber(raw.clicks),
    reach: toNumber(raw.reach),
    frequency: round2(toNumber(raw.frequency)),
    cpc: round2(toNumber(raw.cpc)),
    cpm: round2(toNumber(raw.cpm)),
    ctr: round2(toNumber(raw.ctr)),
    cpp: round2(toNumber(raw.cpp)),
    result: extractResult(raw, options.objective),
    extras,
    ...(breakdowns ? { breakdowns } : {}),
    ...(raw.date_start ? { dateStart: raw.date_start } : {}),
    ...(raw.date_stop ? { dateStop: raw.date_stop } : {}),
    currency: options.currency,
  };
}

/** Resolve MetricSpecs for a list of validated extra-metric field names. */
export function specsForFields(fields: string[]): MetricSpec[] {
  return fields
    .map((f) => getMetricSpec(f))
    .filter((s): s is MetricSpec => s != null);
}
