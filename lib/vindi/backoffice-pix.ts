import { addMonths } from "date-fns";
import { TZDateMini } from "@date-fns/tz";
import type { PlanType, VindiPaymentLinkSource } from "@/lib/db/schema";
import { getCommitmentMonths } from "@/lib/stripe/plans";

export const VINDI_PIX_QR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const VINDI_PAID_OUT_OF_BAND_ACTION = "mark_vindi_paid_out_of_band";

export type ReusableVindiPixLink = {
  id: string;
  planType: PlanType | null;
  amount: number;
  status: string;
  emvPayload: string | null;
  expiresAt: Date;
};

export function findReusableVindiPixLink<T extends ReusableVindiPixLink>(
  links: T[],
  match: { planType: PlanType; amount: number; now: Date },
): T | null {
  return (
    links.find(
      (link) =>
        link.status === "pending" &&
        link.planType === match.planType &&
        link.amount === match.amount &&
        Boolean(link.emvPayload) &&
        link.expiresAt > match.now,
    ) ?? null
  );
}

export function vindiBackofficeLinksToSupersede<
  T extends { planType: PlanType | null; amount: number; status: string },
>(openLinks: T[], next: { planType: PlanType; amount: number }): T[] {
  return openLinks.filter(
    (link) =>
      link.status === "pending" &&
      (link.planType !== next.planType || link.amount !== next.amount),
  );
}

export type BackofficeVindiPixLinkView = {
  id: string;
  planType: PlanType;
  amount: number;
  currency: string;
  preferenceId: string;
  initPoint: string;
  pixCopyPasteCode: string;
  mercadopagoPaymentId: string | null;
  status: string;
  source: string;
  adminEmail: string | null;
  expiresAt: string;
  createdAt: string;
};

export function presentBackofficeVindiPixLink(link: {
  id: string;
  planType: PlanType | null;
  amount: number;
  currency: string;
  emvPayload: string | null;
  vindiBillId: string | null;
  vindiChargeId: string | null;
  status: string;
  source: VindiPaymentLinkSource | string;
  expiresAt: Date;
  createdAt: Date;
}): BackofficeVindiPixLinkView {
  if (!link.planType) {
    throw new Error("Vindi payment link is missing a plan type");
  }
  if (!link.emvPayload) {
    throw new Error("Vindi Pix QR payload was not found");
  }

  return {
    id: link.id,
    planType: link.planType,
    amount: link.amount,
    currency: link.currency,
    preferenceId: link.vindiBillId ?? link.id,
    initPoint: link.emvPayload,
    pixCopyPasteCode: link.emvPayload,
    mercadopagoPaymentId: link.vindiChargeId,
    status: link.status,
    source: link.source,
    adminEmail: null,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
  };
}

export function vindiPixLinkExpiresAt(now: Date): Date {
  return new Date(now.getTime() + VINDI_PIX_QR_TTL_MS);
}

/**
 * O TTL de 7 dias é NOSSO; a Vindi tem o dela (~24h no sandbox, via
 * `max_days_to_keep_waiting_payment`). Mostrar o link como válido além do
 * prazo do PSP fazia o cliente copiar um código morto — manda quem expira
 * PRIMEIRO (mesma regra do frontend, fix #10 da rodada 1).
 */
export function resolveVindiPixLinkExpiresAt(input: {
  now: Date;
  gatewayExpiresAt: Date | null;
}): Date {
  const ceiling = vindiPixLinkExpiresAt(input.now);
  if (!input.gatewayExpiresAt) return ceiling;
  return input.gatewayExpiresAt < ceiling ? input.gatewayExpiresAt : ceiling;
}

export function backofficeVindiPixEmailIdempotencyKey(linkId: string): string {
  return `backoffice-vindi-pix-link:${linkId}`;
}

export function calculateVindiAccessExtension(input: {
  currentExpiration: Date | null;
  planType: PlanType;
  now: Date;
}): Date {
  const base =
    input.currentExpiration && input.currentExpiration > input.now
      ? input.currentExpiration
      : input.now;
  const zonedBase = new TZDateMini(base, "America/Sao_Paulo");
  const zonedExpiration = addMonths(
    zonedBase,
    getCommitmentMonths(input.planType),
  );
  return new Date(zonedExpiration.getTime());
}

export type FailedVindiBillPayment = {
  provider: string | null;
  status: string;
  vindiBillId: string | null;
  subscriptionId: string | null;
};

export function pickFailedVindiBillId(
  payments: readonly FailedVindiBillPayment[],
  activeSubscriptionId?: string | null,
): string | null {
  const isFailedVindiBill = (row: FailedVindiBillPayment) =>
    row.provider === "vindi" &&
    row.status === "failed" &&
    Boolean(row.vindiBillId);

  return (
    payments.find(
      (row) =>
        isFailedVindiBill(row) &&
        (!activeSubscriptionId || row.subscriptionId === activeSubscriptionId),
    )?.vindiBillId ??
    payments.find(isFailedVindiBill)?.vindiBillId ??
    null
  );
}

export type VindiPaidOutOfBandOpenLink = {
  id: string;
  vindiBillId: string | null;
  planType: PlanType | null;
  status: string;
};

export type VindiPaidOutOfBandDecision =
  | { ok: false; reason: "no_open_bill" | "no_plan" }
  | {
      ok: true;
      billIds: string[];
      linkIds: string[];
      planType: PlanType;
      newExpiration: Date;
      auditAction: typeof VINDI_PAID_OUT_OF_BAND_ACTION;
    };

export function decideVindiPaidOutOfBand(input: {
  planType: PlanType | null;
  currentExpiration: Date | null;
  openLinks: VindiPaidOutOfBandOpenLink[];
  failedPaymentBillId: string | null;
  now: Date;
}): VindiPaidOutOfBandDecision {
  const pendingLinks = input.openLinks.filter(
    (link) => link.status === "pending",
  );
  const billIds = uniqueIds([
    ...pendingLinks.map((link) => link.vindiBillId),
    input.failedPaymentBillId,
  ]);
  if (billIds.length === 0) {
    return { ok: false, reason: "no_open_bill" };
  }

  const planType =
    pendingLinks.find((link) => link.planType)?.planType ?? input.planType;
  if (!planType) {
    return { ok: false, reason: "no_plan" };
  }

  return {
    ok: true,
    billIds,
    linkIds: pendingLinks.map((link) => link.id),
    planType,
    newExpiration: calculateVindiAccessExtension({
      currentExpiration: input.currentExpiration,
      planType,
      now: input.now,
    }),
    auditAction: VINDI_PAID_OUT_OF_BAND_ACTION,
  };
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}
