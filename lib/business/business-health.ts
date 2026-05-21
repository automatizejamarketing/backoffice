import type { SubscriptionStatus } from "@/lib/db/schema";

export type BusinessHealthStatus = "critical" | "attention" | "healthy";

export type BusinessHealthReasonCode =
  | "expired"
  | "renewal_critical"
  | "trial_critical"
  | "credits_empty"
  | "renewal_attention"
  | "trial_attention"
  | "inactive"
  | "low_credits"
  | "onboarding_incomplete";

export type BusinessHealthReason = {
  code: BusinessHealthReasonCode;
  severity: Exclude<BusinessHealthStatus, "healthy">;
  label: string;
  description: string;
};

export type BusinessOperatingRules = {
  renewalCriticalDays: number;
  renewalAttentionDays: number;
  trialCriticalDays: number;
  trialAttentionDays: number;
  inactivityAttentionDays: number;
  lowCreditsThreshold: number;
  managedCampaignNamePrefix: string;
  activeManagedCampaignExcludesInactivity: boolean;
};

export type BusinessHealthInput = {
  referenceDate: Date;
  rules: BusinessOperatingRules;
  subscriptionStatus: SubscriptionStatus | null;
  renewalDate: Date | null;
  credits: number;
  onboardingCompleted: boolean;
  lastAiUsageAt: Date | null;
  lastPostAt: Date | null;
  hasActiveManagedCampaign: boolean | null;
};

export type BusinessHealthEvaluation = {
  status: BusinessHealthStatus;
  reasons: BusinessHealthReason[];
  nextAction: string;
  daysUntilRenewal: number | null;
  daysSinceLastActivity: number | null;
  lastActivityAt: Date | null;
  activityShieldedByManagedCampaign: boolean;
};

export type BusinessRuleChange = {
  fieldName: keyof BusinessOperatingRules;
  oldValue: string;
  newValue: string;
};

export const DEFAULT_BUSINESS_OPERATING_RULES: BusinessOperatingRules = {
  renewalCriticalDays: 3,
  renewalAttentionDays: 7,
  trialCriticalDays: 1,
  trialAttentionDays: 3,
  inactivityAttentionDays: 14,
  lowCreditsThreshold: 10,
  managedCampaignNamePrefix: "[AM]",
  activeManagedCampaignExcludesInactivity: true,
};

const BUSINESS_RULE_FIELDS: Array<keyof BusinessOperatingRules> = [
  "renewalCriticalDays",
  "renewalAttentionDays",
  "trialCriticalDays",
  "trialAttentionDays",
  "inactivityAttentionDays",
  "lowCreditsThreshold",
  "managedCampaignNamePrefix",
  "activeManagedCampaignExcludesInactivity",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(referenceDate: Date, targetDate: Date): number {
  return Math.ceil(
    (targetDate.getTime() - referenceDate.getTime()) / DAY_MS,
  );
}

function daysSince(referenceDate: Date, targetDate: Date): number {
  return Math.floor(
    (referenceDate.getTime() - targetDate.getTime()) / DAY_MS,
  );
}

function getLastActivityAt(input: BusinessHealthInput): Date | null {
  const dates = [input.lastAiUsageAt, input.lastPostAt].filter(
    (date): date is Date => date instanceof Date,
  );
  if (dates.length === 0) return null;
  return dates.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest,
  );
}

function addReason(
  reasons: BusinessHealthReason[],
  reason: BusinessHealthReason,
) {
  if (reasons.some((existing) => existing.code === reason.code)) return;
  reasons.push(reason);
}

function chooseNextAction(reasons: BusinessHealthReason[]): string {
  const priority: BusinessHealthReasonCode[] = [
    "expired",
    "renewal_critical",
    "trial_critical",
    "credits_empty",
    "renewal_attention",
    "trial_attention",
    "inactive",
    "low_credits",
    "onboarding_incomplete",
  ];

  const first = priority.find((code) =>
    reasons.some((reason) => reason.code === code),
  );

  switch (first) {
    case "expired":
    case "renewal_critical":
    case "renewal_attention":
      return "Priorizar renovação";
    case "trial_critical":
    case "trial_attention":
      return "Converter trial";
    case "credits_empty":
    case "low_credits":
      return "Revisar créditos";
    case "inactive":
      return "Reativar uso";
    case "onboarding_incomplete":
      return "Completar onboarding";
    default:
      return "Acompanhar normalmente";
  }
}

export function getBusinessRuleChanges(
  oldRules: BusinessOperatingRules,
  newRules: BusinessOperatingRules,
): BusinessRuleChange[] {
  return BUSINESS_RULE_FIELDS.flatMap((fieldName) => {
    const oldValue = String(oldRules[fieldName]);
    const newValue = String(newRules[fieldName]);
    return oldValue === newValue
      ? []
      : [{ fieldName, oldValue, newValue }];
  });
}

export function evaluateBusinessHealth(
  input: BusinessHealthInput,
): BusinessHealthEvaluation {
  const reasons: BusinessHealthReason[] = [];
  const daysUntilRenewal = input.renewalDate
    ? daysBetween(input.referenceDate, input.renewalDate)
    : null;
  const lastActivityAt = getLastActivityAt(input);
  const daysSinceLastActivity = lastActivityAt
    ? daysSince(input.referenceDate, lastActivityAt)
    : null;

  const isTrial = input.subscriptionStatus === "trialing";
  const activityShieldedByManagedCampaign = Boolean(
    input.rules.activeManagedCampaignExcludesInactivity &&
      input.hasActiveManagedCampaign,
  );

  if (daysUntilRenewal !== null && daysUntilRenewal < 0) {
    addReason(reasons, {
      code: "expired",
      severity: "critical",
      label: "Expirado",
      description: "A assinatura ou acesso já passou da data de renovação.",
    });
  } else if (daysUntilRenewal !== null && isTrial) {
    if (daysUntilRenewal <= input.rules.trialCriticalDays) {
      addReason(reasons, {
        code: "trial_critical",
        severity: "critical",
        label: "Trial crítico",
        description: `Trial termina em até ${input.rules.trialCriticalDays} dia(s).`,
      });
    } else if (daysUntilRenewal <= input.rules.trialAttentionDays) {
      addReason(reasons, {
        code: "trial_attention",
        severity: "attention",
        label: "Trial próximo do fim",
        description: `Trial termina em até ${input.rules.trialAttentionDays} dia(s).`,
      });
    }
  } else if (daysUntilRenewal !== null) {
    if (daysUntilRenewal <= input.rules.renewalCriticalDays) {
      addReason(reasons, {
        code: "renewal_critical",
        severity: "critical",
        label: "Renovação crítica",
        description: `Renovação vence em até ${input.rules.renewalCriticalDays} dia(s).`,
      });
    } else if (daysUntilRenewal <= input.rules.renewalAttentionDays) {
      addReason(reasons, {
        code: "renewal_attention",
        severity: "attention",
        label: "Renovação próxima",
        description: `Renovação vence em até ${input.rules.renewalAttentionDays} dia(s).`,
      });
    }
  }

  if (input.credits <= 0) {
    addReason(reasons, {
      code: "credits_empty",
      severity: "critical",
      label: "Sem créditos",
      description: "Cliente está sem créditos disponíveis.",
    });
  } else if (input.credits <= input.rules.lowCreditsThreshold) {
    addReason(reasons, {
      code: "low_credits",
      severity: "attention",
      label: "Créditos baixos",
      description: `Cliente tem ${input.rules.lowCreditsThreshold} crédito(s) ou menos.`,
    });
  }

  const inactive =
    daysSinceLastActivity === null ||
    daysSinceLastActivity >= input.rules.inactivityAttentionDays;

  if (inactive && !activityShieldedByManagedCampaign) {
    addReason(reasons, {
      code: "inactive",
      severity: "attention",
      label: "Sem atividade",
      description: `Sem uso de IA ou posts há ${input.rules.inactivityAttentionDays} dia(s) ou mais.`,
    });
  }

  if (!input.onboardingCompleted) {
    addReason(reasons, {
      code: "onboarding_incomplete",
      severity: "attention",
      label: "Onboarding incompleto",
      description: "Cliente ainda não concluiu o onboarding.",
    });
  }

  const status = reasons.some((reason) => reason.severity === "critical")
    ? "critical"
    : reasons.length > 0
      ? "attention"
      : "healthy";

  return {
    status,
    reasons,
    nextAction: chooseNextAction(reasons),
    daysUntilRenewal,
    daysSinceLastActivity,
    lastActivityAt,
    activityShieldedByManagedCampaign,
  };
}
