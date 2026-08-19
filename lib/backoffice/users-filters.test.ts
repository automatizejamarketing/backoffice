import { describe, expect, test } from "bun:test";
import {
  normalizeUsersFilterParams,
  resolveAccessExpirationRange,
  resolveOperationalExpirationDates,
  resolveUserFieldFilter,
} from "./users-filters";

describe("normalizeUsersFilterParams", () => {
  test("keeps supported user list filters and drops unsupported values", () => {
    const filters = normalizeUsersFilterParams({
      q: " customer@example.com ",
      subscriptionStatus: "past_due",
      planPeriod: "annual",
      metaStatus: "connected",
      activationStatus: "pending",
      consultantId: "550e8400-e29b-41d4-a716-446655440000",
      page: "2",
      pageSize: "20",
    });

    expect(JSON.stringify(filters)).toBe(
      JSON.stringify({
        page: 2,
        pageSize: 20,
        search: "customer@example.com",
        subscriptionStatus: "past_due",
        planPeriod: "annual",
        metaStatus: "connected",
        activationStatus: "pending",
        contactStatus: "all",
        campaignStatus: "all",
        performanceStatus: "all",
        accessExpiration: "all",
        accountStatus: "all",
        fieldFilter: null,
        sort: "default",
        consultantId: "550e8400-e29b-41d4-a716-446655440000",
        signupWithin: "all",
        signupFrom: null,
        signupTo: null,
      }),
    );
  });

  test("normalizes invalid filter values to stable defaults", () => {
    const filters = normalizeUsersFilterParams({
      q: "ab",
      subscriptionStatus: "bad",
      planPeriod: "bad",
      metaStatus: "bad",
      activationStatus: "bad",
      campaignStatus: "bad",
      performanceStatus: "bad",
      accessExpiration: "bad",
      sort: "bad",
      consultantId: "bad",
      page: "-1",
      pageSize: "999",
    });

    expect(JSON.stringify(filters)).toBe(
      JSON.stringify({
        page: 1,
        pageSize: 10,
        search: "",
        subscriptionStatus: "all",
        planPeriod: "all",
        metaStatus: "all",
        activationStatus: "all",
        contactStatus: "all",
        campaignStatus: "all",
        performanceStatus: "all",
        accessExpiration: "all",
        accountStatus: "all",
        fieldFilter: null,
        sort: "default",
        consultantId: "all",
        signupWithin: "all",
        signupFrom: null,
        signupTo: null,
      }),
    );
  });

  test("keeps campaign, performance, access expiration and sort filters", () => {
    const filters = normalizeUsersFilterParams({
      campaignStatus: "active",
      performanceStatus: "drop",
      accessExpiration: "past_7d",
      sort: "renewal",
    });

    expect(filters.campaignStatus).toBe("active");
    expect(filters.performanceStatus).toBe("drop");
    expect(filters.accessExpiration).toBe("past_7d");
    expect(filters.sort).toBe("renewal");
  });

  test("keeps the pending account activation filter", () => {
    const filters = normalizeUsersFilterParams({
      activationStatus: "pending",
    });

    expect(filters.activationStatus).toBe("pending");
  });

  test("keeps the local contact-status filter", () => {
    const filters = normalizeUsersFilterParams({
      contactStatus: "not_contacted",
    });

    expect(filters.contactStatus).toBe("not_contacted");
  });

  test("maps legacy renewal links to the equivalent access window", () => {
    const filters = normalizeUsersFilterParams({ renewalWithin: "3d" });
    expect(filters.accessExpiration).toBe("next_3d");
  });

  test("normalizes a date field filter", () => {
    const filters = normalizeUsersFilterParams({
      filterField: "expirationDate",
      filterOperator: "lt",
      filterValue: "2026-08-04",
    });

    expect(filters.fieldFilter).toEqual({
      field: "expirationDate",
      operator: "lt",
      value: "2026-08-04",
    });
  });

  test("normalizes a numeric field filter", () => {
    const filters = normalizeUsersFilterParams({
      filterField: "credits",
      filterOperator: "gt",
      filterValue: " 10 ",
    });

    expect(filters.fieldFilter).toEqual({
      field: "credits",
      operator: "gt",
      value: "10",
    });
  });

  test("drops an invalid or incomplete field filter", () => {
    const filters = normalizeUsersFilterParams({
      filterField: "expirationDate",
      filterOperator: "contains",
      filterValue: "tomorrow",
    });

    expect(filters.fieldFilter).toBeNull();
  });

  test("accepts performanceStatus unchecked", () => {
    const filters = normalizeUsersFilterParams({
      performanceStatus: "unchecked",
    });
    expect(filters.performanceStatus).toBe("unchecked");
  });

  test("accepts performanceStatus no_drop", () => {
    const filters = normalizeUsersFilterParams({
      performanceStatus: "no_drop",
    });
    expect(filters.performanceStatus).toBe("no_drop");
  });

  test("accepts account status filters", () => {
    const filters = normalizeUsersFilterParams({
      accountStatus: "active_plan_pix",
    });

    expect(filters.accountStatus).toBe("active_plan_pix");
  });

  test("accepts performanceStatus error", () => {
    const filters = normalizeUsersFilterParams({
      performanceStatus: "error",
    });
    expect(filters.performanceStatus).toBe("error");
  });
});

describe("resolveAccessExpirationRange", () => {
  const now = new Date("2026-08-03T15:00:00.000Z");

  test("resolves an upcoming window from expiration_date only", () => {
    expect(resolveAccessExpirationRange("next_3d", now)).toEqual({
      gte: now,
      lt: new Date("2026-08-06T15:00:00.000Z"),
    });
  });

  test("resolves a recently expired window", () => {
    expect(resolveAccessExpirationRange("past_7d", now)).toEqual({
      gte: new Date("2026-07-27T15:00:00.000Z"),
      lt: now,
    });
  });

  test("supports all expired users and users without an expiration date", () => {
    expect(resolveAccessExpirationRange("expired", now)).toEqual({ lt: now });
    expect(resolveAccessExpirationRange("missing", now)).toEqual({
      isMissing: true,
    });
  });
});

describe("resolveUserFieldFilter", () => {
  test("resolves date comparisons as Sao Paulo calendar-day bounds", () => {
    expect(
      resolveUserFieldFilter({
        field: "expirationDate",
        operator: "lt",
        value: "2026-08-04",
      }),
    ).toEqual({
      field: "expirationDate",
      lt: new Date("2026-08-04T03:00:00.000Z"),
    });

    expect(
      resolveUserFieldFilter({
        field: "createdAt",
        operator: "eq",
        value: "2026-08-04",
      }),
    ).toEqual({
      field: "createdAt",
      gte: new Date("2026-08-04T03:00:00.000Z"),
      lt: new Date("2026-08-05T03:00:00.000Z"),
    });

    expect(
      resolveUserFieldFilter({
        field: "expirationDate",
        operator: "gt",
        value: "2026-08-04",
      }),
    ).toEqual({
      field: "expirationDate",
      gte: new Date("2026-08-05T03:00:00.000Z"),
    });
  });

  test("resolves numeric comparisons without date conversion", () => {
    expect(
      resolveUserFieldFilter({
        field: "credits",
        operator: "gt",
        value: "10",
      }),
    ).toEqual({ field: "credits", gt: 10 });
  });
});

describe("resolveOperationalExpirationDates", () => {
  test("uses Sao Paulo calendar dates before and after local midnight", () => {
    expect(
      resolveOperationalExpirationDates(
        new Date("2026-08-03T02:59:59.999Z"),
      ),
    ).toEqual({ yesterday: "2026-08-01", today: "2026-08-02" });

    expect(
      resolveOperationalExpirationDates(
        new Date("2026-08-03T03:00:00.000Z"),
      ),
    ).toEqual({ yesterday: "2026-08-02", today: "2026-08-03" });
  });

  test("handles month and year boundaries", () => {
    expect(
      resolveOperationalExpirationDates(
        new Date("2026-01-01T15:00:00.000Z"),
      ),
    ).toEqual({ yesterday: "2025-12-31", today: "2026-01-01" });
  });
});
