export type EmailDeliveryStatus =
  | "bounced"
  | "canceled"
  | "clicked"
  | "complained"
  | "delivered"
  | "delivery_delayed"
  | "failed"
  | "opened"
  | "queued"
  | "scheduled"
  | "sent"
  | "suppressed";

export type EmailHistoryItem = {
  id: string;
  createdAt: string;
  from: string;
  to: string[];
  subject: string;
  status: EmailDeliveryStatus;
};

const DELIVERED_STATUSES = new Set<EmailDeliveryStatus>([
  "delivered",
  "opened",
  "clicked",
]);
const ENGAGED_STATUSES = new Set<EmailDeliveryStatus>(["opened", "clicked"]);
const PROBLEM_STATUSES = new Set<EmailDeliveryStatus>([
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export function summarizeEmailHistory(emails: EmailHistoryItem[]) {
  return emails.reduce(
    (summary, email) => {
      summary.total += 1;
      if (DELIVERED_STATUSES.has(email.status)) summary.delivered += 1;
      if (ENGAGED_STATUSES.has(email.status)) summary.engaged += 1;
      if (PROBLEM_STATUSES.has(email.status)) summary.problems += 1;
      return summary;
    },
    { total: 0, delivered: 0, engaged: 0, problems: 0 },
  );
}

export function isEmailDeliveryStatus(
  value: string | undefined,
): value is EmailDeliveryStatus {
  return Boolean(
    value &&
      [
        "bounced",
        "canceled",
        "clicked",
        "complained",
        "delivered",
        "delivery_delayed",
        "failed",
        "opened",
        "queued",
        "scheduled",
        "sent",
        "suppressed",
      ].includes(value),
  );
}
