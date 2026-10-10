// Os Indicados de um afiliado, como o operador os lê no sheet de `/referrals`.
//
// Duas definições moram aqui, com teste, em vez de dentro do `SELECT`:
//
//   - **o selo de cada indicado.** Os filtros da tela de Usuários se sobrepõem
//     (quem paga por Pix também é "Plano ativo"), e servem para filtrar. Aqui
//     cada indicado tem UM rótulo, e a ordem de precedência é o que decide se
//     ele aparece como pagante;
//   - **a comissão viva por indicado** — a mesma régua do painel de Métricas:
//     revertida e recusada não somam.

import { ACCOUNT_STATUS_FILTER_LABELS } from "@/lib/backoffice/account-status-filter";
import { countsAsScheduledCancel } from "@/lib/backoffice/customer-base-status";
import type {
  BillingProvider,
  ReferralCommissionStatus,
} from "@/lib/db/schema";
import {
  getAccessBadgeProps,
  getAccessState,
  type StatusBadgeProps,
  type StatusTone,
} from "@/lib/subscriptions/derive";
import {
  REFERRAL_LIVE_COMMISSION_STATUSES,
  tallyReferralCommissionStatuses,
} from "./metrics";

export type ReferralCustomerAccountInput = {
  expirationDate: Date | null;
  hasApprovedPayment: boolean;
  hasSubscription: boolean;
  scheduledCancel: boolean;
  lastPaymentProvider: BillingProvider | null;
};

export type ReferralCustomerAccountStatus =
  | "active_plan"
  | "active_plan_canceled"
  | "active_plan_pix"
  | "subscribed_expired"
  | "paid_no_access_date"
  | "trial_no_payment"
  | "no_card_no_payment";

const PAYING_STATUSES: ReadonlySet<ReferralCustomerAccountStatus> = new Set([
  "active_plan",
  "active_plan_canceled",
  "active_plan_pix",
]);

const STATUS_BADGES: Record<
  ReferralCustomerAccountStatus,
  { label: string; tone: StatusTone }
> = {
  active_plan: { label: ACCOUNT_STATUS_FILTER_LABELS.active_plan, tone: "success" },
  active_plan_canceled: {
    label: ACCOUNT_STATUS_FILTER_LABELS.active_plan_canceled,
    tone: "warning",
  },
  active_plan_pix: {
    label: ACCOUNT_STATUS_FILTER_LABELS.active_plan_pix,
    tone: "success",
  },
  subscribed_expired: {
    label: ACCOUNT_STATUS_FILTER_LABELS.subscribed_expired,
    tone: "destructive",
  },
  // Não existe filtro para este caso na tela de Usuários: pagamento aprovado
  // sem `expiration_date` não cai em nenhum dos seis. Sem rótulo próprio, o
  // indicado sumiria do selo.
  paid_no_access_date: { label: "Pagou, sem data de acesso", tone: "neutral" },
  trial_no_payment: {
    label: ACCOUNT_STATUS_FILTER_LABELS.trial_no_payment,
    tone: "neutral",
  },
  no_card_no_payment: {
    label: ACCOUNT_STATUS_FILTER_LABELS.no_card_no_payment,
    tone: "neutral",
  },
};

export function classifyReferralCustomerAccount(
  input: ReferralCustomerAccountInput,
  now: Date,
): ReferralCustomerAccountStatus {
  if (!input.hasApprovedPayment) {
    return input.hasSubscription ? "trial_no_payment" : "no_card_no_payment";
  }

  const access = getAccessState(input.expirationDate, now);
  if (access.kind === "missing") return "paid_no_access_date";
  if (access.kind === "expired") return "subscribed_expired";

  // Pix antes do cancelamento: a assinatura Stripe cancelada de quem passou a
  // pagar por Pix não é cancelamento (`countsAsScheduledCancel`).
  if (input.lastPaymentProvider === "mercadopago") return "active_plan_pix";
  if (countsAsScheduledCancel(input)) return "active_plan_canceled";
  return "active_plan";
}

/** O selo do indicado, com a data de acesso como detalhe para o tooltip. */
export function describeReferralCustomerAccount(
  input: ReferralCustomerAccountInput,
  now: Date,
): StatusBadgeProps & { status: ReferralCustomerAccountStatus } {
  const status = classifyReferralCustomerAccount(input, now);
  const access = getAccessBadgeProps(input.expirationDate, now);
  return {
    status,
    ...STATUS_BADGES[status],
    hint: access.hint ? `${access.label} · ${access.hint}` : access.label,
  };
}

export type ReferralCustomerCommissionSummary = {
  /** Prevista + aprovada + paga: o que o indicado gerou e continua valendo. */
  liveCentavos: number;
  byStatus: Record<ReferralCommissionStatus, number>;
};

export function summarizeReferralCustomerCommissions(
  rows: readonly {
    status: ReferralCommissionStatus;
    count: number;
    amountCentavos: number;
  }[],
): ReferralCustomerCommissionSummary {
  const totals = tallyReferralCommissionStatuses(rows);
  return {
    liveCentavos: REFERRAL_LIVE_COMMISSION_STATUSES.reduce(
      (sum, status) => sum + totals[status].amountCentavos,
      0,
    ),
    byStatus: {
      foreseen: totals.foreseen.amountCentavos,
      approved: totals.approved.amountCentavos,
      paid: totals.paid.amountCentavos,
      reversed: totals.reversed.amountCentavos,
      rejected: totals.rejected.amountCentavos,
    },
  };
}

export type ReferralAffiliateCustomersSummary = {
  total: number;
  /** Indicados com plano ativo agora — com ou sem cancelamento agendado. */
  paying: number;
  liveCommissionCentavos: number;
};

export function summarizeReferralAffiliateCustomers(
  customers: readonly {
    status: ReferralCustomerAccountStatus;
    liveCommissionCentavos: number;
  }[],
): ReferralAffiliateCustomersSummary {
  return {
    total: customers.length,
    paying: customers.filter((customer) => PAYING_STATUSES.has(customer.status))
      .length,
    liveCommissionCentavos: customers.reduce(
      (sum, customer) => sum + customer.liveCommissionCentavos,
      0,
    ),
  };
}
