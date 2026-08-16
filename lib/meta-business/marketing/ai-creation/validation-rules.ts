/**
 * The rule that decides whether an ad's history PROVES anything (ADR 0022, decisions 1–3).
 *
 * This is the food-service playbook's definition (§10, §11, §16) promoted to a PRODUCT rule: it
 * holds in every niche now, not just food service. Pure — no IO, no Meta.
 */
import { resolveObjectiveResult } from "@/lib/meta-business/insights";

/** How far back the scan looks for proof. */
export const VALIDATION_WINDOW_MONTHS = 12;

/**
 * Where "validado" starts. Below it the playbook calls the ad *funcional* (3–5) — it pays, but it
 * has not proven itself, and it does NOT become a mold.
 */
export const VALIDATED_MIN_ROAS = 5;

/** Daily budget (account currency, MAJOR units) that separates the two spend floors. */
export const DAILY_BUDGET_THRESHOLD = 30;

/** Spend an ad must have accumulated before its numbers mean anything. */
export const SPEND_FLOOR_HIGH_BUDGET = 100;
export const SPEND_FLOOR_LOW_BUDGET = 70;

/** How the elected ad earned the right to be a mold. The two are never conflated in the UI. */
export type MoldKind = "validated" | "best_proven";
export type AdClassification = MoldKind | "none";

/** An ad from the window, with everything the rule needs to judge it. */
export type AdCandidate = {
  adId: string;
  adName: string | null;
  adSetId: string;
  campaignId: string;
  /** The campaign's objective — decides whether a ROAS even exists for this ad. */
  objective: string | null;
  /** Accumulated spend in the window (account currency, MAJOR units). */
  spend: number;
  /**
   * The ad's effective daily budget: the campaign's under CBO, the ad set's under ABO, and `null`
   * when only a lifetime budget exists (no daily number to read).
   */
  dailyBudget: number | null;
  roas: number | null;
  /** The objective-aware Result (see the insights objective→result glossary). */
  result: { label: string; count: number | null; costPerResult: number | null };
};

/**
 * The spend an ad must have cleared, given its daily budget. An UNKNOWN budget takes the high
 * floor: we would rather miss a mold than copy an unproven one.
 */
export function spendFloorFor(dailyBudget: number | null): number {
  if (dailyBudget == null) return SPEND_FLOOR_HIGH_BUDGET;
  return dailyBudget >= DAILY_BUDGET_THRESHOLD
    ? SPEND_FLOOR_HIGH_BUDGET
    : SPEND_FLOOR_LOW_BUDGET;
}

/** Whether this objective produces a ROAS at all (sales-shaped) — sales is judged by ROAS only. */
export function hasRoas(objective: string | null): boolean {
  return resolveObjectiveResult(objective).hasValue;
}

/**
 * Judge one ad.
 *
 * SALES IS STRICT: without ROAS >= 5 there is no mold, however much the ad spent. We do not degrade
 * it into "cheapest purchase" — the validation rule IS the rule, and below it history is not proof
 * (the flow falls back to the niche presets instead).
 */
export function classifyAd(candidate: AdCandidate): AdClassification {
  if (candidate.spend < spendFloorFor(candidate.dailyBudget)) return "none";

  if (hasRoas(candidate.objective)) {
    return (candidate.roas ?? 0) >= VALIDATED_MIN_ROAS ? "validated" : "none";
  }

  // No ROAS to prove anything with (leads, messages, traffic, followers): the cheapest RESULT is
  // the proof. An ad that produced no result — or whose objective has no cost-per-result at all,
  // like reach — proves nothing.
  const produced =
    (candidate.result.count ?? 0) > 0 && candidate.result.costPerResult != null;
  return produced ? "best_proven" : "none";
}
