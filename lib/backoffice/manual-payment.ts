import { addMonths } from "date-fns";
import { TZDateMini } from "@date-fns/tz";
import type { PlanType } from "@/lib/db/schema";
import { PLAN_TYPE_VALUES } from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";

export const MANUAL_PAYMENT_TIME_ZONE = "America/Sao_Paulo";
export const MANUAL_PAYMENT_MONTHLY_CREDITS = 250;

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ManualPaymentQuoteError =
  | "invalid_plan"
  | "payment_date_in_future";

export type ManualPaymentQuote = {
  amountCentavos: number;
  credits: number;
  commitmentMonths: number;
  newExpiration: Date;
};

export type QuoteManualPaymentResult =
  | ({ ok: true } & ManualPaymentQuote)
  | { ok: false; error: ManualPaymentQuoteError };

export type ManualPaymentEventType = "subscribed" | "renewed" | "plan_changed";

export function isManualPaymentPlanType(value: string): value is PlanType {
  return (PLAN_TYPE_VALUES as readonly string[]).includes(value);
}

export function saoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANUAL_PAYMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayYmdInSaoPaulo(now = new Date()): string {
  return saoPauloDateKey(now);
}

export function parseManualPaymentDate(ymd: string): Date {
  const match = YMD_PATTERN.exec(ymd.trim());
  if (!match) {
    return new Date(Number.NaN);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const zoned = new TZDateMini(
    year,
    month - 1,
    day,
    12,
    0,
    0,
    0,
    MANUAL_PAYMENT_TIME_ZONE,
  );
  return new Date(zoned.getTime());
}

export function calculateManualPaymentExpiration({
  currentExpiration,
  paidAt,
  commitmentMonths,
}: {
  currentExpiration: Date | null;
  paidAt: Date;
  commitmentMonths: number;
}): Date {
  const base =
    currentExpiration && currentExpiration > paidAt
      ? currentExpiration
      : paidAt;
  const zonedBase = new TZDateMini(base, MANUAL_PAYMENT_TIME_ZONE);
  const zonedExpiration = addMonths(zonedBase, commitmentMonths);
  return new Date(zonedExpiration.getTime());
}

export function resolveManualPaymentEventType(
  existingSubscription: { planType: PlanType } | null,
  targetPlanType: PlanType,
): ManualPaymentEventType {
  if (!existingSubscription) return "subscribed";
  if (existingSubscription.planType === targetPlanType) return "renewed";
  return "plan_changed";
}

export function quoteManualPayment({
  planType,
  paidAt,
  currentExpiration,
  now = new Date(),
}: {
  planType: string;
  paidAt: Date;
  currentExpiration: Date | null;
  now?: Date;
}): QuoteManualPaymentResult {
  if (!isManualPaymentPlanType(planType)) {
    return { ok: false, error: "invalid_plan" };
  }

  if (saoPauloDateKey(paidAt) > saoPauloDateKey(now)) {
    return { ok: false, error: "payment_date_in_future" };
  }

  const definition = PLAN_DEFINITIONS[planType];
  const commitmentMonths = definition.commitmentMonths;
  const newExpiration = calculateManualPaymentExpiration({
    currentExpiration,
    paidAt,
    commitmentMonths,
  });

  return {
    ok: true,
    amountCentavos: definition.totalCommitmentCentavos,
    credits: MANUAL_PAYMENT_MONTHLY_CREDITS * commitmentMonths,
    commitmentMonths,
    newExpiration,
  };
}
