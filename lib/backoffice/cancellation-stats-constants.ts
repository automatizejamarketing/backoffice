export const VALID_CANCELLATION_STATS_PROVIDERS = [
  "stripe",
  "mercadopago",
  "manual",
] as const;

export const VALID_CANCELLATION_STATS_PLANS = [
  "monthly_starter",
  "monthly_pro",
  "monthly_premium",
  "quarterly_starter",
  "quarterly_pro",
  "quarterly_premium",
  "semiannual_starter",
  "semiannual_pro",
  "semiannual_premium",
  "annual_starter",
  "annual_pro",
  "annual_premium",
] as const;
