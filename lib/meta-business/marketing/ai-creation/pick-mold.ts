/**
 * Elect ONE mold out of the account's candidates (ADR 0022). Pure — no IO.
 *
 * TIE-BREAK = SPEND, not recency. An aggregated insights row (no `time_increment`) reports
 * `date_stop` = the end of the requested window for EVERY ad, so "last delivery" is not a number
 * Meta gives us here — a recency tie-break would read as a rule and behave as a coin toss. Buying a
 * real per-ad delivery date would cost a 365-row-per-ad time series. Spend is honest, available and
 * deterministic: the ad the account backed hardest wins the tie.
 */
import {
  classifyAd,
  type AdCandidate,
  type MoldKind,
} from "./validation-rules";

/** The elected ad, and how it earned it. What the review screen explains to the user. */
export type MoldRef = {
  kind: MoldKind;
  adId: string;
  adName: string | null;
  /** The ad set that hosts it — the one whose configuration gets cloned. */
  adSetId: string;
  campaignId: string;
  objective: string | null;
  metrics: {
    spend: number;
    roas: number | null;
    resultLabel: string;
    resultCount: number | null;
    costPerResult: number | null;
    currency: string;
  };
};

/** Highest ROAS, then the heaviest spender. */
function bestByRoas(candidates: AdCandidate[]): AdCandidate {
  return [...candidates].sort(
    (a, b) => (b.roas ?? 0) - (a.roas ?? 0) || b.spend - a.spend,
  )[0];
}

/** Cheapest result, then the heaviest spender. */
function bestByCost(candidates: AdCandidate[]): AdCandidate {
  return [...candidates].sort(
    (a, b) =>
      (a.result.costPerResult ?? Infinity) - (b.result.costPerResult ?? Infinity) ||
      b.spend - a.spend,
  )[0];
}

/**
 * Which objective the account is actually running, among the proven ads: the one with the most
 * money behind it.
 *
 * Cost per result is NOT comparable across objectives — a link click is always cheaper than a lead,
 * so ranking every proven ad by cost alone would hand the mold to the account's least valuable
 * objective (a R$150 traffic ad would beat a R$50k leads history). So the objective is picked
 * first, by total spend, and only then the cheapest ad WITHIN it.
 */
function dominantObjective(candidates: AdCandidate[]): string | null {
  const spendByObjective = new Map<string | null, number>();
  for (const candidate of candidates) {
    const objective = candidate.objective;
    spendByObjective.set(
      objective,
      (spendByObjective.get(objective) ?? 0) + candidate.spend,
    );
  }

  let winner: string | null = null;
  let best = -Infinity;
  for (const [objective, spend] of spendByObjective) {
    if (spend > best) {
      best = spend;
      winner = objective;
    }
  }
  return winner;
}

function toMoldRef(
  candidate: AdCandidate,
  kind: MoldKind,
  currency: string,
): MoldRef {
  return {
    kind,
    adId: candidate.adId,
    adName: candidate.adName,
    adSetId: candidate.adSetId,
    campaignId: candidate.campaignId,
    objective: candidate.objective,
    metrics: {
      spend: candidate.spend,
      roas: candidate.roas,
      resultLabel: candidate.result.label,
      resultCount: candidate.result.count,
      costPerResult: candidate.result.costPerResult,
      currency,
    },
  };
}

/**
 * The election, in one place:
 *   1. a VALIDATED ad (ROAS >= 5 above the floor) always wins — highest ROAS;
 *   2. otherwise the BEST PROVEN ad of the account's dominant objective — cheapest result;
 *   3. otherwise nothing, and the flow falls back to the niche presets, silently.
 */
export function pickMold(
  candidates: AdCandidate[],
  currency: string,
): MoldRef | null {
  const validated: AdCandidate[] = [];
  const proven: AdCandidate[] = [];

  for (const candidate of candidates) {
    const kind = classifyAd(candidate);
    if (kind === "validated") validated.push(candidate);
    else if (kind === "best_proven") proven.push(candidate);
  }

  if (validated.length > 0) {
    return toMoldRef(bestByRoas(validated), "validated", currency);
  }
  if (proven.length === 0) return null;

  const objective = dominantObjective(proven);
  const withinObjective = proven.filter((c) => c.objective === objective);
  return toMoldRef(bestByCost(withinObjective), "best_proven", currency);
}
