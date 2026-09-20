import type { BillingProvider, PlanType } from "@/lib/db/schema";

export const RETENTION_REASON_KEYS = [
  "price_too_high",
  "not_getting_results",
  "setup_difficulty",
  "usage_difficulty",
  "other",
] as const;

export type RetentionReasonKey = (typeof RETENTION_REASON_KEYS)[number];
export type CancellationStatsOfferKind = "discount" | "specialist";

export const RETENTION_REASON_LABELS: Record<RetentionReasonKey, string> = {
  price_too_high: "Preço acima do orçamento",
  not_getting_results: "Resultados abaixo do esperado",
  setup_difficulty: "Dificuldade para configurar",
  usage_difficulty: "Dificuldade para usar",
  other: "Outro motivo",
};

export type CancellationStatsRate = {
  numerator: number;
  denominator: number;
  percent: number;
};

export type CancellationStatsSummary = {
  reasons: Array<{
    reason: RetentionReasonKey;
    label: string;
    attempts: number;
    share: CancellationStatsRate;
  }>;
  offers: Array<{
    kind: CancellationStatsOfferKind;
    shown: number;
    accepted: CancellationStatsRate;
  }>;
  completed: CancellationStatsRate;
  scheduled: CancellationStatsRate;
  effectiveRetention30d: CancellationStatsRate;
  immatureAcceptedAttempts: number;
};

export type CancellationStatsEvent = {
  attemptId: string;
  eventType:
    | "offer_shown"
    | "offer_accepted"
    | "calendar_opened"
    | "cancellation_provider_confirmed"
    | "cancellation_scheduled"
    | "cancellation_completed"
    | "pix_paid"
    | "invoice_paid"
    | string;
  occurredAt: Date | string;
  offerType?: CancellationStatsOfferKind | null;
  reason?: RetentionReasonKey | null;
  offerRevision?: string | null;
};

export type CancellationStatsPayment = {
  status: string;
  paidAt: Date | string | null;
};

export type CancellationStatsAttempt = {
  id: string;
  userId: string;
  subscriptionId?: string | null;
  startedAt: Date | string;
  provider: BillingProvider | string;
  planType: PlanType | string;
  reason?: string | null;
  /** Accepted for input so callers can verify this never reaches the output. */
  reasonDetails?: string | null;
  offerType?: string | null;
  decisionAt?: Date | string | null;
  /** Legacy fallback: a reserved discount benefit can anchor acceptance. */
  acceptedAt?: Date | string | null;
  outcome?: string | null;
  outcomeAt?: Date | string | null;
  accessValidUntil?: Date | string | null;
  accessValidAt?: boolean;
  renewalDueAt?: Date | string | null;
  renewalPayment?: CancellationStatsPayment | null;
  /** A provider-confirmed payment can be supplied when the query has already correlated it. */
  renewalPaymentConfirmed?: boolean;
  offerRevision?: string | null;
  /** No meeting-confirmation event exists yet, but this allows a future provider to supply one. */
  meetingConfirmed?: boolean;
};

export type CancellationStatsFilters = {
  provider?: BillingProvider;
  planType?: PlanType;
};

export type CancellationStatsWindow = {
  gte: Date;
  lt: Date;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rate(numerator: number, denominator: number): CancellationStatsRate {
  return {
    numerator,
    denominator,
    percent:
      denominator === 0
        ? 0
        : Math.round((numerator / denominator) * 1000) / 10,
  };
}

function isRetentionReason(value: string | null | undefined): value is RetentionReasonKey {
  return (
    typeof value === "string" &&
    (RETENTION_REASON_KEYS as readonly string[]).includes(value)
  );
}

function eventOfferType(
  event: CancellationStatsEvent,
  attempt: CancellationStatsAttempt,
): CancellationStatsOfferKind | null {
  if (event.offerType === "discount" || event.offerType === "specialist") {
    return event.offerType;
  }
  return attempt.offerType === "discount" || attempt.offerType === "specialist"
    ? attempt.offerType
    : null;
}

function eventMatchesCurrentOffer(
  event: CancellationStatsEvent,
  attempt: CancellationStatsAttempt,
  kind: CancellationStatsOfferKind,
) {
  if (eventOfferType(event, attempt) !== kind) return false;
  if (event.offerRevision && attempt.offerRevision && event.offerRevision !== attempt.offerRevision) return false;
  // New events carry the reason that produced the offer. This excludes an old
  // offer after the customer changed reasons while preserving legacy rows.
  return !event.reason || !attempt.reason || event.reason === attempt.reason;
}

function isWithin(value: Date | string, window: CancellationStatsWindow) {
  const date = toDate(value);
  return date !== null && date >= window.gte && date < window.lt;
}

function isMatured(
  acceptedAt: Date,
  asOf: Date,
): boolean {
  return acceptedAt.getTime() + 30 * 24 * 60 * 60 * 1000 <= asOf.getTime();
}

function hasEffectiveAccess(attempt: CancellationStatsAttempt, asOf: Date) {
  if (attempt.accessValidAt === false) return false;
  const expiration = toDate(attempt.accessValidUntil);
  return attempt.accessValidAt === true || (expiration !== null && expiration > asOf);
}

function hasRenewalPayment(attempt: CancellationStatsAttempt, asOf: Date) {
  if (attempt.renewalPaymentConfirmed === true) return true;
  const payment = attempt.renewalPayment;
  return (
    payment?.status === "succeeded" &&
    toDate(payment.paidAt) !== null &&
    (toDate(payment.paidAt) as Date) <= asOf
  );
}

export function summarizeCancellationStats(input: {
  attempts: CancellationStatsAttempt[];
  events: CancellationStatsEvent[];
  window: CancellationStatsWindow;
  filters?: CancellationStatsFilters;
  asOf?: Date;
}): CancellationStatsSummary {
  const asOf = input.asOf ?? new Date();
  const eventByAttempt = new Map<string, CancellationStatsEvent[]>();
  for (const event of input.events) {
    const events = eventByAttempt.get(event.attemptId) ?? [];
    events.push(event);
    eventByAttempt.set(event.attemptId, events);
  }

  const attempts = new Map<string, CancellationStatsAttempt>();
  for (const candidate of input.attempts) {
    if (!isWithin(candidate.startedAt, input.window)) continue;
    if (input.filters?.provider && candidate.provider !== input.filters.provider) continue;
    if (input.filters?.planType && candidate.planType !== input.filters.planType) continue;
    // A repeated row for one attempt must not make any denominator larger.
    attempts.set(candidate.id, candidate);
  }

  const scoped = [...attempts.values()];
  const reasoned = scoped.filter((attempt) => isRetentionReason(attempt.reason));
  const reasonCounts = new Map<RetentionReasonKey, number>();
  for (const reason of RETENTION_REASON_KEYS) reasonCounts.set(reason, 0);
  for (const attempt of reasoned) {
    reasonCounts.set(attempt.reason as RetentionReasonKey, (reasonCounts.get(attempt.reason as RetentionReasonKey) ?? 0) + 1);
  }

  const reasons = RETENTION_REASON_KEYS.map((reason) => ({
    reason,
    label: RETENTION_REASON_LABELS[reason],
    attempts: reasonCounts.get(reason) ?? 0,
    share: rate(reasonCounts.get(reason) ?? 0, reasoned.length),
  }));

  const offers = (['discount', 'specialist'] as const).map((kind) => {
    const shownAttempts = scoped.filter((attempt) => {
      if (attempt.offerType !== kind) return false;
      return (eventByAttempt.get(attempt.id) ?? []).some(
        (event) => event.eventType === "offer_shown" && eventMatchesCurrentOffer(event, attempt, kind),
      );
    });
    const acceptedAttempts = shownAttempts.filter((attempt) =>
      (eventByAttempt.get(attempt.id) ?? []).some(
        (event) => event.eventType === "offer_accepted" && eventMatchesCurrentOffer(event, attempt, kind),
      ),
    );
    return {
      kind,
      shown: shownAttempts.length,
      accepted: rate(acceptedAttempts.length, shownAttempts.length),
    };
  });

  const completed = scoped.filter((attempt) => {
    const events = eventByAttempt.get(attempt.id) ?? [];
    return (
      attempt.outcome === "canceled" ||
      events.some((event) => event.eventType === "cancellation_completed")
    );
  }).length;
  const scheduled = scoped.filter((attempt) => {
    const events = eventByAttempt.get(attempt.id) ?? [];
    return (
      attempt.outcome === "scheduled" ||
      events.some((event) => event.eventType === "cancellation_scheduled")
    );
  }).length;

  const accepted: Array<{ attempt: CancellationStatsAttempt; acceptedAt: Date }> = [];
  for (const attempt of scoped) {
    const acceptedEvents = (eventByAttempt.get(attempt.id) ?? [])
      .filter(
        (event) =>
          event.eventType === "offer_accepted" &&
          eventOfferType(event, attempt) === attempt.offerType &&
          (!event.reason || !attempt.reason || event.reason === attempt.reason),
      )
      .map((event) => ({ event, occurredAt: toDate(event.occurredAt) }))
      .filter((item): item is { event: CancellationStatsEvent; occurredAt: Date } => item.occurredAt !== null)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const first = acceptedEvents[0];
    const fallback = toDate(attempt.acceptedAt);
    if (first) accepted.push({ attempt, acceptedAt: first.occurredAt });
    else if (fallback) accepted.push({ attempt, acceptedAt: fallback });
  }
  const matured = accepted.filter((item) => isMatured(item.acceptedAt, asOf));
  const effective = matured.filter(({ attempt }) => {
    // Opening Calendly records specialist acceptance and intent only. Until a
    // durable meeting confirmation exists it cannot be effective retention.
    if (attempt.offerType === "specialist" && attempt.meetingConfirmed !== true) {
      return false;
    }
    // A pending or merely generated PIX is never payment proof, even while
    // the current prepaid access has not reached its renewal date.
    if (
      attempt.provider === "mercadopago" &&
      attempt.renewalPayment?.status !== "succeeded" &&
      attempt.renewalPaymentConfirmed !== true
    ) {
      return false;
    }
    if (!hasEffectiveAccess(attempt, asOf)) return false;
    const dueAt = toDate(attempt.renewalDueAt);
    return dueAt === null || dueAt > asOf || hasRenewalPayment(attempt, asOf);
  }).length;

  return {
    reasons,
    offers,
    completed: rate(completed, scoped.length),
    scheduled: rate(scheduled, scoped.length),
    effectiveRetention30d: rate(effective, matured.length),
    immatureAcceptedAttempts: accepted.filter(({ acceptedAt }) => !isMatured(acceptedAt, asOf)).length,
  };
}

export {
  VALID_CANCELLATION_STATS_PLANS,
  VALID_CANCELLATION_STATS_PROVIDERS,
} from "./cancellation-stats-constants";
