import { describe, expect, test } from "bun:test";
import { normalizeUsersFilterParams } from "./users-filters";

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

    expect(JSON.stringify(filters)).toBe(JSON.stringify({
      page: 2,
      pageSize: 20,
      search: "customer@example.com",
      subscriptionStatus: "past_due",
      planPeriod: "annual",
      metaStatus: "connected",
      consultantId: "550e8400-e29b-41d4-a716-446655440000",
      signupWithin: "all",
      signupFrom: null,
      signupTo: null,
    }));
  });

  test("normalizes invalid filter values to stable defaults", () => {
    const filters = normalizeUsersFilterParams({
      q: "ab",
      subscriptionStatus: "bad",
      planPeriod: "bad",
      metaStatus: "bad",
      consultantId: "bad",
      page: "-1",
      pageSize: "999",
    });

    expect(JSON.stringify(filters)).toBe(JSON.stringify({
      page: 1,
      pageSize: 10,
      search: "",
      subscriptionStatus: "all",
      planPeriod: "all",
      metaStatus: "all",
      consultantId: "all",
      signupWithin: "all",
      signupFrom: null,
      signupTo: null,
    }));
  });
});
