import { describe, expect, test } from "bun:test";
import {
  applyUsersFocusFilter,
  getUsersFocusFilterKey,
  normalizeUsersFilterParams,
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
        renewalWithin: "all",
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
      renewalWithin: "bad",
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
        renewalWithin: "all",
        sort: "default",
        consultantId: "all",
        signupWithin: "all",
        signupFrom: null,
        signupTo: null,
      }),
    );
  });

  test("keeps campaign, performance, renewal and sort filters", () => {
    const filters = normalizeUsersFilterParams({
      campaignStatus: "active",
      performanceStatus: "drop",
      renewalWithin: "3d",
      sort: "renewal",
    });

    expect(filters.campaignStatus).toBe("active");
    expect(filters.performanceStatus).toBe("drop");
    expect(filters.renewalWithin).toBe("3d");
    expect(filters.sort).toBe("renewal");
  });
});

describe("users focus filter", () => {
  test("encodes renewal focus and clears other dimensions on apply", () => {
    const applied = applyUsersFocusFilter("renewal:7d");
    expect(applied.renewalWithin).toBe("7d");
    expect(applied.performanceStatus).toBe("all");
    expect(applied.subscriptionStatus).toBe("all");
    expect(getUsersFocusFilterKey(applied)).toBe("renewal:7d");
  });

  test("applies consultant focus", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const applied = applyUsersFocusFilter(`consultant:${id}`);
    expect(applied.consultantId).toBe(id);
    expect(getUsersFocusFilterKey(applied)).toBe(`consultant:${id}`);
  });
});
