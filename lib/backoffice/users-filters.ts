import type { SubscriptionStatus } from "@/lib/db/schema";

export const USER_LIST_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const USER_LIST_DEFAULT_PAGE_SIZE = 10;
export const USER_LIST_MIN_SEARCH_LENGTH = 3;

export const SUBSCRIPTION_STATUS_FILTER_VALUES = [
  "all",
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

export type SubscriptionStatusFilter =
  (typeof SUBSCRIPTION_STATUS_FILTER_VALUES)[number];
export type PlanPeriodFilter = (typeof PLAN_PERIOD_FILTER_VALUES)[number];
export type MetaStatusFilter = (typeof META_STATUS_FILTER_VALUES)[number];
export type ConsultantFilter = string | "all" | "unassigned";

export type UsersFilterParams = {
  page: number;
  pageSize: number;
  search: string;
  subscriptionStatus: SubscriptionStatusFilter;
  planPeriod: PlanPeriodFilter;
  metaStatus: MetaStatusFilter;
  consultantId: ConsultantFilter;
};

type RawUsersFilterParams = {
  page?: string;
  pageSize?: string;
  q?: string;
  subscriptionStatus?: string;
  planPeriod?: string;
  metaStatus?: string;
  consultantId?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    consultantId,
  };
}

export function subscriptionStatusFromFilter(
  value: SubscriptionStatusFilter,
): SubscriptionStatus | null {
  return value === "all" ? null : value;
}
