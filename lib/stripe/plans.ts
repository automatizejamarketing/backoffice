import { addDays, addMonths, addYears } from "date-fns";
import type { PlanType } from "@/lib/db/schema";
import { PLAN_TYPE_VALUES } from "@/lib/db/schema";

export const FREE_TRIAL_DAYS = 15;
export const FREE_TRIAL_CREDITS = 100;

export type PlanTier = "starter" | "pro" | "premium";
export type BillingPeriod = "monthly" | "quarterly" | "semiannual" | "annual";

export interface PlanDefinition {
  id: PlanType;
  tier: PlanTier;
  period: BillingPeriod;
  name: string;
  description: string;
  interval: "month" | "year";
  intervalCount: number;
  hierarchy: number;
}

const TIER_RANK: Record<PlanTier, number> = {
  starter: 1,
  pro: 2,
  premium: 3,
};

const PERIOD_RANK: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 2,
  semiannual: 3,
  annual: 4,
};

const TIER_LABELS: Record<PlanTier, string> = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
};

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const PERIOD_DESCRIPTIONS: Record<BillingPeriod, string> = {
  monthly: "Cobrança mensal",
  quarterly: "Cobrança a cada 3 meses",
  semiannual: "Cobrança a cada 6 meses",
  annual: "Cobrança anual",
};

function buildDefinition(
  period: BillingPeriod,
  tier: PlanTier,
): PlanDefinition {
  const id = `${period}_${tier}` as PlanType;
  const interval: "month" | "year" = period === "annual" ? "year" : "month";
  const intervalCount =
    period === "monthly"
      ? 1
      : period === "quarterly"
        ? 3
        : period === "semiannual"
          ? 6
          : 1; // annual = 1 year

  return {
    id,
    tier,
    period,
    name: `${TIER_LABELS[tier]} ${PERIOD_LABELS[period]}`,
    description: `${TIER_LABELS[tier]} — ${PERIOD_DESCRIPTIONS[period]}`,
    interval,
    intervalCount,
    hierarchy: TIER_RANK[tier] * 100 + PERIOD_RANK[period],
  };
}

const ALL_PERIODS: BillingPeriod[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
];
const ALL_TIERS: PlanTier[] = ["starter", "pro", "premium"];

export const PLAN_DEFINITIONS: Record<PlanType, PlanDefinition> =
  Object.fromEntries(
    ALL_PERIODS.flatMap((period) =>
      ALL_TIERS.map((tier) => {
        const def = buildDefinition(period, tier);
        return [def.id, def];
      }),
    ),
  ) as Record<PlanType, PlanDefinition>;

export const PLAN_TYPES: PlanType[] = [...PLAN_TYPE_VALUES];

// ---------- Utility functions ----------

export function getPlanTier(planType: PlanType): PlanTier {
  return PLAN_DEFINITIONS[planType].tier;
}

export function getBillingPeriod(planType: PlanType): BillingPeriod {
  return PLAN_DEFINITIONS[planType].period;
}

export function buildPlanType(period: BillingPeriod, tier: PlanTier): PlanType {
  return `${period}_${tier}` as PlanType;
}

// ---------- Stripe price env vars ----------

const ENV_VAR_MAP: Record<PlanType, string> = {
  monthly_starter: "STRIPE_PRICE_MONTHLY_STARTER",
  monthly_pro: "STRIPE_PRICE_MONTHLY_PRO",
  monthly_premium: "STRIPE_PRICE_MONTHLY_PREMIUM",
  quarterly_starter: "STRIPE_PRICE_QUARTERLY_STARTER",
  quarterly_pro: "STRIPE_PRICE_QUARTERLY_PRO",
  quarterly_premium: "STRIPE_PRICE_QUARTERLY_PREMIUM",
  semiannual_starter: "STRIPE_PRICE_SEMIAANNUAL_STARTER",
  semiannual_pro: "STRIPE_PRICE_SEMIAANNUAL_PRO",
  semiannual_premium: "STRIPE_PRICE_SEMIAANNUAL_PREMIUM",
  annual_starter: "STRIPE_PRICE_ANNUAL_STARTER",
  annual_pro: "STRIPE_PRICE_ANNUAL_PRO",
  annual_premium: "STRIPE_PRICE_ANNUAL_PREMIUM",
};

export function getPlanPriceEnvVar(planType: PlanType): string {
  return ENV_VAR_MAP[planType];
}

export function getStripePriceId(planType: PlanType): string {
  const envVar = getPlanPriceEnvVar(planType);
  const priceId = process.env[envVar];
  if (!priceId) {
    throw new Error(`${envVar} is not set in environment variables`);
  }
  return priceId;
}

// ---------- Upgrade / downgrade helpers ----------

export function isUpgrade(
  currentPlan: PlanType,
  targetPlan: PlanType,
): boolean {
  return (
    PLAN_DEFINITIONS[targetPlan].hierarchy >
    PLAN_DEFINITIONS[currentPlan].hierarchy
  );
}

export function isDowngrade(
  currentPlan: PlanType,
  targetPlan: PlanType,
): boolean {
  return (
    PLAN_DEFINITIONS[targetPlan].hierarchy <
    PLAN_DEFINITIONS[currentPlan].hierarchy
  );
}

export function isSamePlan(
  currentPlan: PlanType,
  targetPlan: PlanType,
): boolean {
  return currentPlan === targetPlan;
}

// ---------- Duration / expiration helpers ----------

export function getPlanDuration(planType: PlanType): {
  months: number;
  years: number;
} {
  const plan = PLAN_DEFINITIONS[planType];
  if (plan.interval === "year") {
    return { months: 0, years: plan.intervalCount };
  }
  return { months: plan.intervalCount, years: 0 };
}

export function calculateNewExpiration(
  currentExpiration: Date | null,
  planType: PlanType,
): Date {
  const baseDate =
    currentExpiration && currentExpiration > new Date()
      ? currentExpiration
      : new Date();

  const duration = getPlanDuration(planType);

  let newExpiration = baseDate;
  if (duration.months > 0) {
    newExpiration = addMonths(newExpiration, duration.months);
  }
  if (duration.years > 0) {
    newExpiration = addYears(newExpiration, duration.years);
  }

  return newExpiration;
}

export function getTrialEndDate(): Date {
  return addDays(new Date(), FREE_TRIAL_DAYS);
}

export function getPlanTypeFromMetadata(
  metadata: Record<string, string> | null | undefined,
): PlanType | null {
  if (!metadata?.plan_type) return null;
  const planType = metadata.plan_type as PlanType;
  if (!PLAN_DEFINITIONS[planType]) return null;
  return planType;
}
