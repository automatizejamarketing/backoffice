export type ExpertPayoutStatus =
  | "requested"
  | "approved"
  | "paid"
  | "rejected"
  | "canceled";

const PAYOUT_TRANSITIONS: Record<ExpertPayoutStatus, ExpertPayoutStatus[]> = {
  requested: ["approved", "rejected", "canceled"],
  approved: ["paid", "rejected", "canceled"],
  paid: [],
  rejected: [],
  canceled: [],
};

export function canTransitionPayout(
  from: ExpertPayoutStatus,
  to: ExpertPayoutStatus,
): boolean {
  return from === to || PAYOUT_TRANSITIONS[from].includes(to);
}
