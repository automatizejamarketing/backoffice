import type { SubscriptionStatus } from "@/lib/db/schema";

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
] as const;

/** Days until renewal window: 0 ≤ daysUntil ≤ N. */
export const RENEWAL_WITHIN_FILTER_VALUES = ["all", "1d", "3d", "7d"] as const;

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
export type RenewalWithinFilter =
  (typeof RENEWAL_WITHIN_FILTER_VALUES)[number];
export type UsersSort = (typeof USERS_SORT_VALUES)[number];
export type SignupWithinFilter = (typeof SIGNUP_WITHIN_FILTER_VALUES)[number];
export type ConsultantFilter = string | "all" | "unassigned";

export type UsersFilterParams = {
  page: number;
  pageSize: number;
  search: string;
  subscriptionStatus: SubscriptionStatusFilter;
  planPeriod: PlanPeriodFilter;
  metaStatus: MetaStatusFilter;
  campaignStatus: CampaignStatusFilter;
  performanceStatus: PerformanceStatusFilter;
  renewalWithin: RenewalWithinFilter;
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
  renewalWithin?: string;
  sort?: string;
  consultantId?: string;
  signupWithin?: string;
  signupFrom?: string;
  signupTo?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function emptyUsersDimensionFilters(): Pick<
  UsersFilterParams,
  | "subscriptionStatus"
  | "planPeriod"
  | "metaStatus"
  | "campaignStatus"
  | "performanceStatus"
  | "renewalWithin"
  | "consultantId"
  | "signupWithin"
  | "signupFrom"
  | "signupTo"
> {
  return {
    subscriptionStatus: "all",
    planPeriod: "all",
    metaStatus: "all",
    campaignStatus: "all",
    performanceStatus: "all",
    renewalWithin: "all",
    consultantId: "all",
    signupWithin: "all",
    signupFrom: null,
    signupTo: null,
  };
}

/**
 * Single-select key for the unified filter dropdown. Dimensions are mutually
 * exclusive in the UI: picking one clears the others.
 */
export type UsersFocusFilterKey =
  | "all"
  | `renewal:${Exclude<RenewalWithinFilter, "all">}`
  | `performance:${Exclude<PerformanceStatusFilter, "all">}`
  | `campaign:${Exclude<CampaignStatusFilter, "all">}`
  | `meta:${Exclude<MetaStatusFilter, "all">}`
  | `subscription:${Exclude<SubscriptionStatusFilter, "all">}`
  | `plan:${Exclude<PlanPeriodFilter, "all">}`
  | `signup:${Exclude<SignupWithinFilter, "all">}`
  | `consultant:${string}`;

export function getUsersFocusFilterKey(
  filters: Pick<
    UsersFilterParams,
    | "renewalWithin"
    | "performanceStatus"
    | "campaignStatus"
    | "metaStatus"
    | "subscriptionStatus"
    | "planPeriod"
    | "signupWithin"
    | "consultantId"
  >,
): UsersFocusFilterKey {
  if (filters.renewalWithin !== "all") {
    return `renewal:${filters.renewalWithin}`;
  }
  if (filters.performanceStatus !== "all") {
    return `performance:${filters.performanceStatus}`;
  }
  if (filters.campaignStatus !== "all") {
    return `campaign:${filters.campaignStatus}`;
  }
  if (filters.metaStatus !== "all") {
    return `meta:${filters.metaStatus}`;
  }
  if (filters.subscriptionStatus !== "all") {
    return `subscription:${filters.subscriptionStatus}`;
  }
  if (filters.planPeriod !== "all") {
    return `plan:${filters.planPeriod}`;
  }
  if (filters.signupWithin !== "all") {
    return `signup:${filters.signupWithin}`;
  }
  if (filters.consultantId !== "all") {
    return `consultant:${filters.consultantId}`;
  }
  return "all";
}

export function applyUsersFocusFilter(
  focus: string,
): ReturnType<typeof emptyUsersDimensionFilters> {
  const base = emptyUsersDimensionFilters();
  if (!focus || focus === "all") return base;

  const [group, value] = focus.split(":");
  if (!group || !value) return base;

  switch (group) {
    case "renewal":
      if (includesValue(RENEWAL_WITHIN_FILTER_VALUES, value) && value !== "all") {
        return { ...base, renewalWithin: value };
      }
      return base;
    case "performance":
      if (
        includesValue(PERFORMANCE_STATUS_FILTER_VALUES, value) &&
        value !== "all"
      ) {
        return { ...base, performanceStatus: value };
      }
      return base;
    case "campaign":
      if (
        includesValue(CAMPAIGN_STATUS_FILTER_VALUES, value) &&
        value !== "all"
      ) {
        return { ...base, campaignStatus: value };
      }
      return base;
    case "meta":
      if (includesValue(META_STATUS_FILTER_VALUES, value) && value !== "all") {
        return { ...base, metaStatus: value };
      }
      return base;
    case "subscription":
      if (
        includesValue(SUBSCRIPTION_STATUS_FILTER_VALUES, value) &&
        value !== "all"
      ) {
        return { ...base, subscriptionStatus: value };
      }
      return base;
    case "plan":
      if (includesValue(PLAN_PERIOD_FILTER_VALUES, value) && value !== "all") {
        return { ...base, planPeriod: value };
      }
      return base;
    case "signup":
      if (includesValue(SIGNUP_WITHIN_FILTER_VALUES, value) && value !== "all") {
        return { ...base, signupWithin: value };
      }
      return base;
    case "consultant":
      if (value === "unassigned" || uuidPattern.test(value)) {
        return { ...base, consultantId: value };
      }
      return base;
    default:
      return base;
  }
}

/** Parse "1d" / "3d" / "7d" into day count; null for "all" or invalid. */
export function renewalWithinDays(
  value: RenewalWithinFilter,
): number | null {
  if (value === "all") return null;
  const days = Number.parseInt(value, 10);
  return Number.isFinite(days) && days > 0 ? days : null;
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

  const consultantId =
    raw.consultantId === "unassigned"
      ? raw.consultantId
      : raw.consultantId && uuidPattern.test(raw.consultantId)
        ? raw.consultantId
        : "all";

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
    renewalWithin: includesValue(
      RENEWAL_WITHIN_FILTER_VALUES,
      raw.renewalWithin,
    )
      ? raw.renewalWithin
      : "all",
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
