import {
  ACCOUNT_RULE_CARD_PAYMENT_FAILED,
  ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN,
  ACCOUNT_RULE_PIX_EXPIRING,
  ACCOUNT_RULE_RECENTLY_CANCELED,
  type AccountAlertRuleId,
} from "./constants";

export type AccountAlertThresholds = {
  pixAttentionDays: number;
  pixCriticalDays: number;
  cardFailureLookbackDays: number;
  canceledLookbackDays: number;
};

export const DEFAULT_ACCOUNT_ALERT_THRESHOLDS: AccountAlertThresholds = {
  pixAttentionDays: 7,
  pixCriticalDays: 3,
  cardFailureLookbackDays: 14,
  canceledLookbackDays: 14,
};

export type AccountAlertSubject = {
  userId: string;
  clientName: string | null;
  hasActiveAccess: boolean;
  hasMeta: boolean;
  campaignChecked: boolean;
  hasActiveManagedCampaign: boolean;
  lastPaymentIsPix: boolean;
  daysUntilExpiration: number | null;
  subscriptionProvider: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  daysSinceCanceled: number | null;
  /** Days since the latest Stripe billing failure that is newer than the latest success. */
  daysSinceCardFailure: number | null;
  cardFailureReason: string | null;
};

export type AccountAlertCandidate = {
  ruleId: AccountAlertRuleId;
  entityId: string;
  entityLevel: "account";
  entityName: string | null;
  severity: "critical" | "warning";
  confidence: "high";
  actionType: "review_account";
  title: string;
  evidence: string;
  recommendation: string;
  metrics: Record<string, string | number | boolean | null>;
};

const CARD_PROBLEM_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

function daysLabel(days: number): string {
  if (days <= 0) return "hoje";
  if (days === 1) return "em 1 dia";
  return `em ${days} dias`;
}

function sinceLabel(days: number): string {
  if (days <= 0) return "hoje";
  if (days === 1) return "há 1 dia";
  return `há ${days} dias`;
}

function base(
  subject: AccountAlertSubject,
  ruleId: AccountAlertRuleId,
  fields: Pick<
    AccountAlertCandidate,
    "severity" | "title" | "evidence" | "recommendation" | "metrics"
  >,
): AccountAlertCandidate {
  return {
    ruleId,
    entityId: subject.userId,
    entityLevel: "account",
    entityName: subject.clientName,
    confidence: "high",
    actionType: "review_account",
    ...fields,
  };
}

export function evaluateAccountAlerts(args: {
  subject: AccountAlertSubject;
  thresholds: AccountAlertThresholds;
  enabledRuleIds: ReadonlySet<string>;
}): AccountAlertCandidate[] {
  const { subject, enabledRuleIds } = args;
  const pixCriticalDays = Math.min(
    args.thresholds.pixCriticalDays,
    args.thresholds.pixAttentionDays,
  );
  const candidates: AccountAlertCandidate[] = [];

  const cancelCandidate = enabledRuleIds.has(ACCOUNT_RULE_RECENTLY_CANCELED)
    ? evaluateCanceled(subject, args.thresholds, pixCriticalDays)
    : null;

  if (
    enabledRuleIds.has(ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN) &&
    subject.hasActiveAccess &&
    subject.hasMeta &&
    subject.campaignChecked &&
    !subject.hasActiveManagedCampaign
  ) {
    candidates.push(
      base(subject, ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN, {
        severity: "warning",
        title: "Sem campanha ativa",
        evidence:
          "Acesso vigente, Meta conectado e nenhuma campanha [AM] ativa na última checagem.",
        recommendation:
          "Abrir o cliente e subir ou reativar uma campanha [AM].",
        metrics: {
          hasMeta: true,
          campaignChecked: true,
          hasActiveManagedCampaign: false,
        },
      }),
    );
  }

  const pixDue =
    subject.hasActiveAccess &&
    subject.lastPaymentIsPix &&
    subject.daysUntilExpiration !== null &&
    subject.daysUntilExpiration >= 0 &&
    subject.daysUntilExpiration <= args.thresholds.pixAttentionDays;

  if (
    enabledRuleIds.has(ACCOUNT_RULE_PIX_EXPIRING) &&
    pixDue &&
    !cancelCandidate &&
    subject.daysUntilExpiration !== null
  ) {
    const critical = subject.daysUntilExpiration <= pixCriticalDays;
    candidates.push(
      base(subject, ACCOUNT_RULE_PIX_EXPIRING, {
        severity: critical ? "critical" : "warning",
        title: critical ? "PIX vence em breve" : "PIX próximo do vencimento",
        evidence: `Último pagamento foi PIX e o acesso vence ${daysLabel(subject.daysUntilExpiration)}. PIX não renova sozinho.`,
        recommendation: "Cobrar o PIX antes da expiração do acesso.",
        metrics: {
          daysUntilExpiration: subject.daysUntilExpiration,
          lastPaymentIsPix: true,
        },
      }),
    );
  }

  const cardProvider =
    subject.subscriptionProvider === "stripe" ||
    subject.subscriptionProvider === "vindi";
  const recentFailure =
    !subject.lastPaymentIsPix &&
    subject.daysSinceCardFailure !== null &&
    subject.daysSinceCardFailure >= 0 &&
    subject.daysSinceCardFailure <= args.thresholds.cardFailureLookbackDays;
  const cardProblem =
    !subject.lastPaymentIsPix &&
    subject.subscriptionStatus !== "canceled" &&
    ((cardProvider && CARD_PROBLEM_STATUSES.has(subject.subscriptionStatus ?? "")) ||
      recentFailure);

  if (enabledRuleIds.has(ACCOUNT_RULE_CARD_PAYMENT_FAILED) && cardProblem) {
    const reason = subject.cardFailureReason?.trim();
    const status = subject.subscriptionStatus ?? "desconhecido";
    const provider =
      subject.subscriptionProvider === "vindi" ? "Vindi" : "Stripe";
    candidates.push(
      base(subject, ACCOUNT_RULE_CARD_PAYMENT_FAILED, {
        severity: "critical",
        title: "Cartão com falha de pagamento",
        evidence: reason
          ? `Assinatura ${provider} ${status}. Última falha: ${reason}.`
          : `Assinatura ${provider} ${status} com cobrança no cartão que não passou.`,
        recommendation: "Recuperar o pagamento do cartão na ficha do cliente.",
        metrics: {
          subscriptionStatus: status,
          daysSinceCardFailure: subject.daysSinceCardFailure,
          cardFailureReason: reason || null,
        },
      }),
    );
  }

  if (cancelCandidate) candidates.push(cancelCandidate);

  return candidates;
}

function evaluateCanceled(
  subject: AccountAlertSubject,
  thresholds: AccountAlertThresholds,
  criticalDays: number,
): AccountAlertCandidate | null {
  const scheduled =
    subject.cancelAtPeriodEnd &&
    subject.hasActiveAccess &&
    subject.subscriptionStatus !== "canceled";

  if (scheduled) {
    const days = subject.daysUntilExpiration;
    const critical = days !== null && days <= criticalDays;
    return base(subject, ACCOUNT_RULE_RECENTLY_CANCELED, {
      severity: critical ? "critical" : "warning",
      title: "Cancelamento agendado",
      evidence:
        days === null
          ? "O cliente pediu cancelamento e o acesso ainda está vigente."
          : `O cliente pediu cancelamento. O acesso acaba ${daysLabel(days)}.`,
      recommendation: "Ligar enquanto o acesso ainda vale e tentar reter.",
      metrics: {
        cancelAtPeriodEnd: true,
        daysUntilExpiration: days,
        subscriptionStatus: subject.subscriptionStatus,
      },
    });
  }

  const recentlyCanceled =
    subject.subscriptionStatus === "canceled" &&
    subject.daysSinceCanceled !== null &&
    subject.daysSinceCanceled >= 0 &&
    subject.daysSinceCanceled <= thresholds.canceledLookbackDays;

  if (!recentlyCanceled || subject.daysSinceCanceled === null) return null;

  return base(subject, ACCOUNT_RULE_RECENTLY_CANCELED, {
    severity: subject.daysSinceCanceled <= criticalDays ? "critical" : "warning",
    title: "Assinatura cancelada recentemente",
    evidence: `Assinatura cancelada ${sinceLabel(subject.daysSinceCanceled)}.`,
    recommendation: "Ligar para tentar recuperar o cliente.",
    metrics: {
      daysSinceCanceled: subject.daysSinceCanceled,
      subscriptionStatus: "canceled",
    },
  });
}
