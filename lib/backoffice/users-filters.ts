import type { SubscriptionStatus } from "@/lib/db/schema";
import {
  normalizeConsultantFilterId,
  type ConsultantFilterId,
} from "@/lib/backoffice/filter-params";

export const USER_LIST_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const USER_LIST_DEFAULT_PAGE_SIZE = 10;
export const USER_LIST_MIN_SEARCH_LENGTH = 3;

export const SUBSCRIPTION_STATUS_FILTER_VALUES = [
  "all",
  "none",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
] as const;

export const PLAN_PERIOD_FILTER_VALUES = [
  "all",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;

export const META_STATUS_FILTER_VALUES = [
  "all",
  "connected",
  "disconnected",
] as const;

export const CAMPAIGN_STATUS_FILTER_VALUES = [
  "all",
  "active",
  "inactive",
  "unchecked",
] as const;

export const PERFORMANCE_STATUS_FILTER_VALUES = [
  "all",
  "drop",
  "no_drop",
  "error",
  "unchecked",
] as const;

/**
 * Business access windows derived exclusively from users.expiration_date.
 * Billing provider and subscription status must not affect this filter.
 */
export const ACCESS_EXPIRATION_FILTER_VALUES = [
  "all",
  "next_1d",
  "next_3d",
  "next_7d",
  "past_3d",
  "past_7d",
  "past_14d",
  "past_30d",
  "expired",
  "missing",
] as const;

export const USER_FIELD_FILTER_VALUES = [
  "expirationDate",
  "createdAt",
  "credits",
] as const;

export const USER_FIELD_FILTER_OPERATOR_VALUES = ["lt", "eq", "gt"] as const;

export const USERS_SORT_VALUES = [
  "default",
  "renewal",
  "performance",
  "campaign",
] as const;

// Registration-date ("data de cadastro") window presets. Every value other
// than "all"/"custom" is a day count parsed with parseInt (e.g. "7d" -> 7).
export const SIGNUP_WITHIN_FILTER_VALUES = [
  "all",
  "3d",
  "7d",
  "14d",
  "30d",
  "custom",
] as const;

export type SubscriptionStatusFilter =
  (typeof SUBSCRIPTION_STATUS_FILTER_VALUES)[number];
export type PlanPeriodFilter = (typeof PLAN_PERIOD_FILTER_VALUES)[number];
export type MetaStatusFilter = (typeof META_STATUS_FILTER_VALUES)[number];
export type CampaignStatusFilter =
  (typeof CAMPAIGN_STATUS_FILTER_VALUES)[number];
export type PerformanceStatusFilter =
  (typeof PERFORMANCE_STATUS_FILTER_VALUES)[number];
export type AccessExpirationFilter =
  (typeof ACCESS_EXPIRATION_FILTER_VALUES)[number];
export type UserFieldFilterField =
  (typeof USER_FIELD_FILTER_VALUES)[number];
export type UserFieldFilterOperator =
  (typeof USER_FIELD_FILTER_OPERATOR_VALUES)[number];
export type UserFieldFilter = {
  field: UserFieldFilterField;
  operator: UserFieldFilterOperator;
  value: string;
};
export type UsersSort = (typeof USERS_SORT_VALUES)[number];
export type SignupWithinFilter = (typeof SIGNUP_WITHIN_FILTER_VALUES)[number];
export type ConsultantFilter = ConsultantFilterId;

export type UsersFilterParams = {
  page: number;
  pageSize: number;
  search: string;
  subscriptionStatus: SubscriptionStatusFilter;
  planPeriod: PlanPeriodFilter;
  metaStatus: MetaStatusFilter;
  campaignStatus: CampaignStatusFilter;
  performanceStatus: PerformanceStatusFilter;
  accessExpiration: AccessExpirationFilter;
  fieldFilter: UserFieldFilter | null;
  sort: UsersSort;
  consultantId: ConsultantFilter;
  signupWithin: SignupWithinFilter;
  // yyyy-mm-dd (America/Sao_Paulo calendar dates); only populated when
  // signupWithin === "custom" and both ends form a valid from <= to range.
  signupFrom: string | null;
  signupTo: string | null;
};

type RawUsersFilterParams = {
  page?: string;
  pageSize?: string;
  q?: string;
  subscriptionStatus?: string;
  planPeriod?: string;
  metaStatus?: string;
  campaignStatus?: string;
  performanceStatus?: string;
  accessExpiration?: string;
  filterField?: string;
  filterOperator?: string;
  filterValue?: string;
  /** Legacy URL parameter kept so old shared links still resolve. */
  renewalWithin?: string;
  sort?: string;
  consultantId?: string | string[];
  signupWithin?: string;
  signupFrom?: string;
  signupTo?: string;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: string | undefined,
): value is T[number] {
  return Boolean(value && values.includes(value));
}

// Validate a yyyy-mm-dd string and confirm it names a real calendar date
// (rejects e.g. 2026-02-31). Returns the normalized string or null.
function parseIsoDateString(value: string | undefined): string | null {
  if (!value || !isoDatePattern.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessExpirationRange = {
  gte?: Date;
  lt?: Date;
  isMissing?: boolean;
};

/**
 * Resolve an access window without consulting Stripe, Mercado Pago or any
 * subscription row. Bounds are half-open: gte <= expiration_date < lt.
 */
export function resolveAccessExpirationRange(
  value: AccessExpirationFilter,
  now: Date = new Date(),
): AccessExpirationRange {
  if (value === "all") return {};
  if (value === "missing") return { isMissing: true };
  if (value === "expired") return { lt: now };

  const [direction, rawDays] = value.split("_");
  const days = Number.parseInt(rawDays, 10);
  if (!Number.isFinite(days) || days <= 0) return {};

  if (direction === "next") {
    return {
      gte: now,
      lt: new Date(now.getTime() + days * DAY_MS),
    };
  }

  return {
    gte: new Date(now.getTime() - days * DAY_MS),
    lt: now,
  };
}

function normalizeAccessExpiration(
  accessExpiration: string | undefined,
  legacyRenewalWithin: string | undefined,
): AccessExpirationFilter {
  if (
    includesValue(ACCESS_EXPIRATION_FILTER_VALUES, accessExpiration)
  ) {
    return accessExpiration;
  }

  const legacyMap: Record<string, AccessExpirationFilter> = {
    "1d": "next_1d",
    "3d": "next_3d",
    "7d": "next_7d",
  };
  return legacyRenewalWithin
    ? (legacyMap[legacyRenewalWithin] ?? "all")
    : "all";
}

function normalizeUserFieldFilter(
  field: string | undefined,
  operator: string | undefined,
  value: string | undefined,
): UserFieldFilter | null {
  if (
    !includesValue(USER_FIELD_FILTER_VALUES, field) ||
    !includesValue(USER_FIELD_FILTER_OPERATOR_VALUES, operator)
  ) {
    return null;
  }

  const trimmedValue = value?.trim();
  if (!trimmedValue) return null;

  if (field === "credits") {
    const numericValue = Number(trimmedValue);
    if (!Number.isInteger(numericValue)) return null;
    return { field, operator, value: String(numericValue) };
  }

  const dateValue = parseIsoDateString(trimmedValue);
  return dateValue ? { field, operator, value: dateValue } : null;
}

export function normalizeUsersFilterParams(
  raw: RawUsersFilterParams,
): UsersFilterParams {
  const requestedPageSize = parsePositiveInt(
    raw.pageSize,
    USER_LIST_DEFAULT_PAGE_SIZE,
  );
  const pageSize = USER_LIST_PAGE_SIZE_OPTIONS.includes(
    requestedPageSize as (typeof USER_LIST_PAGE_SIZE_OPTIONS)[number],
  )
    ? requestedPageSize
    : USER_LIST_DEFAULT_PAGE_SIZE;

  const trimmedSearch = raw.q?.trim() ?? "";
  const search =
    trimmedSearch.length >= USER_LIST_MIN_SEARCH_LENGTH ? trimmedSearch : "";

  const consultantId = normalizeConsultantFilterId(raw.consultantId);

  // Registration-date window. A "custom" selection is honored only when both
  // ends are valid dates forming a non-inverted range; otherwise it collapses
  // to "all" (no date filter) so a malformed URL never silently hides users.
  let signupWithin: SignupWithinFilter = includesValue(
    SIGNUP_WITHIN_FILTER_VALUES,
    raw.signupWithin,
  )
    ? raw.signupWithin
    : "all";
  let signupFrom: string | null = null;
  let signupTo: string | null = null;
  if (signupWithin === "custom") {
    const from = parseIsoDateString(raw.signupFrom);
    const to = parseIsoDateString(raw.signupTo);
    if (from && to && from <= to) {
      signupFrom = from;
      signupTo = to;
    } else {
      signupWithin = "all";
    }
  }

  return {
    page: parsePositiveInt(raw.page, 1),
    pageSize,
    search,
    subscriptionStatus: includesValue(
      SUBSCRIPTION_STATUS_FILTER_VALUES,
      raw.subscriptionStatus,
    )
      ? raw.subscriptionStatus
      : "all",
    planPeriod: includesValue(PLAN_PERIOD_FILTER_VALUES, raw.planPeriod)
      ? raw.planPeriod
      : "all",
    metaStatus: includesValue(META_STATUS_FILTER_VALUES, raw.metaStatus)
      ? raw.metaStatus
      : "all",
    campaignStatus: includesValue(
      CAMPAIGN_STATUS_FILTER_VALUES,
      raw.campaignStatus,
    )
      ? raw.campaignStatus
      : "all",
    performanceStatus: includesValue(
      PERFORMANCE_STATUS_FILTER_VALUES,
      raw.performanceStatus,
    )
      ? raw.performanceStatus
      : "all",
    accessExpiration: normalizeAccessExpiration(
      raw.accessExpiration,
      raw.renewalWithin,
    ),
    fieldFilter: normalizeUserFieldFilter(
      raw.filterField,
      raw.filterOperator,
      raw.filterValue,
    ),
    sort: includesValue(USERS_SORT_VALUES, raw.sort) ? raw.sort : "default",
    consultantId,
    signupWithin,
    signupFrom,
    signupTo,
  };
}

export function subscriptionStatusFromFilter(
  value: SubscriptionStatusFilter,
): SubscriptionStatus | null {
  // Neither "all" (no filter) nor "none" (never-subscribed) is a Stripe status.
  return value === "all" || value === "none" ? null : value;
}

// Brazil has run on a fixed UTC-3 with no DST since 2019, so 00:00 in
// America/Sao_Paulo is always 03:00 UTC on the same calendar date.
const BRT_START_OF_DAY_UTC_HOUR = 3;

// Start of the given BRT calendar day as a UTC instant. Day/month overflow is
// normalized by Date.UTC (e.g. day 0 -> last day of the previous month).
function brtStartOfDayUtc(year: number, month1: number, day: number): Date {
  return new Date(
    Date.UTC(year, month1 - 1, day, BRT_START_OF_DAY_UTC_HOUR, 0, 0, 0),
  );
}

function formatUtcCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type OperationalExpirationDates = {
  yesterday: string;
  today: string;
};

/** Calendar dates used by the users-page operational expiration shortcuts. */
export function resolveOperationalExpirationDates(
  now: Date = new Date(),
): OperationalExpirationDates {
  const brtNow = new Date(
    now.getTime() - BRT_START_OF_DAY_UTC_HOUR * 60 * 60 * 1000,
  );
  const yesterday = new Date(brtNow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  return {
    yesterday: formatUtcCalendarDate(yesterday),
    today: formatUtcCalendarDate(brtNow),
  };
}

export type ResolvedUserFieldFilter = {
  field: UserFieldFilterField;
  gte?: Date;
  gt?: number;
  lt?: Date | number;
  eq?: number;
};

export function resolveUserFieldFilter(
  filter: UserFieldFilter,
): ResolvedUserFieldFilter {
  if (filter.field === "credits") {
    const value = Number(filter.value);
    if (filter.operator === "lt") return { field: filter.field, lt: value };
    if (filter.operator === "eq") return { field: filter.field, eq: value };
    return { field: filter.field, gt: value };
  }

  const [year, month, day] = filter.value.split("-").map(Number);
  const start = brtStartOfDayUtc(year, month, day);
  const nextDay = brtStartOfDayUtc(year, month, day + 1);

  if (filter.operator === "lt") return { field: filter.field, lt: start };
  if (filter.operator === "eq") {
    return { field: filter.field, gte: start, lt: nextDay };
  }
  return { field: filter.field, gte: nextDay };
}

export type SignupDateRange = { gte?: Date; lt?: Date };

// Translate the registration-date filter into half-open UTC bounds on
// users.created_at: gte <= created_at < lt. Presets are BRT calendar-day
// aligned and cover today plus the (N-1) prior days; custom ranges are
// end-inclusive of the whole `until` day. Returns {} for "all" or an
// unresolved custom range (i.e. no date filter). Because created_at is
// nullable and NULL fails every comparison, users with no signup date are
// naturally excluded from any bounded range.
export function resolveSignupDateRange(
  filters: Pick<UsersFilterParams, "signupWithin" | "signupFrom" | "signupTo">,
  now: Date = new Date(),
): SignupDateRange {
  const { signupWithin } = filters;
  if (signupWithin === "all") return {};

  if (signupWithin === "custom") {
    if (!filters.signupFrom || !filters.signupTo) return {};
    const [fromYear, fromMonth, fromDay] = filters.signupFrom
      .split("-")
      .map(Number);
    const [toYear, toMonth, toDay] = filters.signupTo.split("-").map(Number);
    return {
      gte: brtStartOfDayUtc(fromYear, fromMonth, fromDay),
      // end-inclusive: strictly before the start of the day after `until`.
      lt: brtStartOfDayUtc(toYear, toMonth, toDay + 1),
    };
  }

  // Presets like "7d" -> 7 days. Derive today's BRT calendar date from `now`
  // by shifting the instant back 3h and reading its UTC date parts.
  const days = Number.parseInt(signupWithin, 10);
  const brtNow = new Date(
    now.getTime() - BRT_START_OF_DAY_UTC_HOUR * 60 * 60 * 1000,
  );
  return {
    gte: brtStartOfDayUtc(
      brtNow.getUTCFullYear(),
      brtNow.getUTCMonth() + 1,
      brtNow.getUTCDate() - (days - 1),
    ),
  };
}
