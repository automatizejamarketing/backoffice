import { describe, expect, test } from "bun:test";
import {
  canAccessMarketingUser,
  canAccessUserHubTab,
  hasBackofficePermission,
  type BackofficeActor,
} from "./rbac-core";

const admin: BackofficeActor = {
  id: "admin-1",
  email: "admin@example.com",
  role: "admin",
  source: "database",
};

const consultant: BackofficeActor = {
  id: "consultant-1",
  email: "consultant@example.com",
  role: "marketing_consultant",
  source: "database",
  assignedUserIds: ["user-1", "user-2"],
};

describe("hasBackofficePermission", () => {
  test("allows admins to use every known permission", () => {
    expect(hasBackofficePermission(admin, "users:manage")).toBe(true);
    expect(hasBackofficePermission(admin, "marketing:write")).toBe(true);
    expect(hasBackofficePermission(admin, "team:manage")).toBe(true);
  });

  test("limits marketing consultants to marketing portfolio access", () => {
    expect(hasBackofficePermission(consultant, "marketing:read")).toBe(true);
    expect(hasBackofficePermission(consultant, "marketing:write")).toBe(true);
    expect(hasBackofficePermission(consultant, "users:manage")).toBe(false);
    expect(hasBackofficePermission(consultant, "billing:manage")).toBe(false);
  });
});

describe("canAccessMarketingUser", () => {
  test("allows admins to access any customer user", () => {
    expect(canAccessMarketingUser(admin, "any-user")).toBe(true);
  });

  test("allows consultants to access assigned customer users", () => {
    expect(canAccessMarketingUser(consultant, "user-1")).toBe(true);
  });

  test("blocks consultants from unassigned customer users", () => {
    expect(canAccessMarketingUser(consultant, "user-3")).toBe(false);
  });
});

describe("canAccessUserHubTab", () => {
  test("allows admins to access every user hub tab", () => {
    expect(canAccessUserHubTab(admin, "any-user", "summary")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "subscription")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "marketing")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "audit")).toBe(true);
  });

  test("limits assigned consultants to the marketing tab", () => {
    expect(canAccessUserHubTab(consultant, "user-1", "marketing")).toBe(true);
    expect(canAccessUserHubTab(consultant, "user-1", "summary")).toBe(false);
    expect(canAccessUserHubTab(consultant, "user-1", "subscription")).toBe(
      false,
    );
  });

  test("blocks consultants from unassigned user hub tabs", () => {
    expect(canAccessUserHubTab(consultant, "user-3", "marketing")).toBe(false);
  });
});
