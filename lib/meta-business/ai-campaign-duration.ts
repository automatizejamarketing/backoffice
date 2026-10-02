/** Shared AI-only defaults and arithmetic; safe to import in the client. */
export type AiCampaignDurationDays = 7 | 30;

export type AiCampaignPeriod = {
  startTime: string;
  endTime: string;
};

export type AiCampaignPeriodInput = Partial<AiCampaignPeriod>;

export type AiCampaignDurationPolicy = {
  accountState: "trial" | "active" | "legacy";
  defaultDurationDays: AiCampaignDurationDays;
};

const DAY_MS = 86_400_000;

export function campaignDurationDays(state: {
  hasAccess: boolean;
  subscriptionStatus: string | null;
}): AiCampaignDurationDays {
  return state.subscriptionStatus === "trialing" || !state.hasAccess ? 7 : 30;
}

function periodInstants(period: AiCampaignPeriod): { start: number; end: number } {
  const start = Date.parse(period.startTime);
  const end = Date.parse(period.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError("O período da campanha precisa de datas válidas, com término após o início.");
  }
  return { start, end };
}

/** Fill missing dates, retaining the caller's start rule and every explicit instant. */
export function resolveAiCampaignPeriod(input: {
  period?: AiCampaignPeriodInput;
  defaultDurationDays: AiCampaignDurationDays;
  defaultStartTime: string;
}): AiCampaignPeriod {
  const startTime = input.period?.startTime?.trim() || input.defaultStartTime;
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) {
    throw new RangeError("O início da campanha precisa de uma data válida.");
  }
  const endTime = input.period?.endTime?.trim()
    || new Date(start + input.defaultDurationDays * DAY_MS).toISOString();
  const instants = periodInstants({ startTime, endTime });
  return {
    startTime: new Date(instants.start).toISOString(),
    endTime: new Date(instants.end).toISOString(),
  };
}

/** Elapsed days, rounding a partial day up without adding an inclusive extra day. */
export function campaignPeriodDays(period: AiCampaignPeriod): number {
  const { start, end } = periodInstants(period);
  return Math.ceil((end - start) / DAY_MS);
}

export function derivedLifetimeBudgetCents(
  dailyBudgetMajor: number,
  period: AiCampaignPeriod,
): number {
  return Math.round(dailyBudgetMajor * 100) * campaignPeriodDays(period);
}
