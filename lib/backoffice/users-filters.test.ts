import { describe, expect, test } from "bun:test";
import {
  normalizeUsersFilterParams,
  resolveAccessExpirationRange,
} from "./users-filters";

describe("normalizeUsersFilterParams", () => {
  test("keeps supported user list filters and drops unsupported values", () => {
    const filters = normalizeUsersFilterParams({
      q: " customer@example.com ",
      subscriptionStatus: "past_due",
      planPeriod: "annual",
      metaStatus: "connected",
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
        campaignStatus: "all",
        performanceStatus: "all",
        accessExpiration: "all",
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
        campaignStatus: "all",
        performanceStatus: "all",
        accessExpiration: "all",
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

  test("maps legacy renewal links to the equivalent access window", () => {
    const filters = normalizeUsersFilterParams({ renewalWithin: "3d" });
    expect(filters.accessExpiration).toBe("next_3d");
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
