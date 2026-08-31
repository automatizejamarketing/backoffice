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

const financeViewer: BackofficeActor = {
  id: "finance-1",
  email: "finance@example.com",
  role: "finance_viewer",
  source: "finance_email_fallback",
};

const dev: BackofficeActor = {
  id: "dev-1",
  email: "dev@example.com",
  role: "dev",
  source: "database",
};

describe("hasBackofficePermission", () => {
  test("allows admins to use every known permission", () => {
    expect(hasBackofficePermission(admin, "users:manage")).toBe(true);
    expect(hasBackofficePermission(admin, "marketing:write")).toBe(true);
    expect(hasBackofficePermission(admin, "team:manage")).toBe(true);
    expect(hasBackofficePermission(admin, "finance:view")).toBe(true);
    expect(hasBackofficePermission(admin, "emails:view")).toBe(true);
    expect(hasBackofficePermission(admin, "whatsapp:view")).toBe(true);
    expect(
      hasBackofficePermission(admin, "creative-analysis:manage"),
    ).toBe(true);
  });

  test("limits marketing consultants to marketing portfolio access", () => {
    expect(hasBackofficePermission(consultant, "marketing:read")).toBe(true);
    expect(hasBackofficePermission(consultant, "marketing:write")).toBe(true);
    expect(hasBackofficePermission(consultant, "users:manage")).toBe(false);
    expect(hasBackofficePermission(consultant, "billing:manage")).toBe(false);
    expect(hasBackofficePermission(consultant, "whatsapp:view")).toBe(false);
    expect(
      hasBackofficePermission(consultant, "creative-analysis:manage"),
    ).toBe(false);
  });

  test("limits finance viewers to the financial area", () => {
    expect(hasBackofficePermission(financeViewer, "finance:view")).toBe(true);
    expect(hasBackofficePermission(financeViewer, "dashboard:view")).toBe(false);
    expect(hasBackofficePermission(financeViewer, "users:manage")).toBe(false);
    expect(hasBackofficePermission(financeViewer, "emails:view")).toBe(false);
    expect(hasBackofficePermission(financeViewer, "marketing:read")).toBe(false);
    expect(hasBackofficePermission(financeViewer, "whatsapp:view")).toBe(false);
    expect(
      hasBackofficePermission(financeViewer, "creative-analysis:manage"),
    ).toBe(false);
  });

  test("gives dev technical access without finance, billing, or team", () => {
    expect(hasBackofficePermission(dev, "dashboard:view")).toBe(true);
    expect(hasBackofficePermission(dev, "users:manage")).toBe(true);
    expect(hasBackofficePermission(dev, "products:manage")).toBe(true);
    expect(hasBackofficePermission(dev, "marketing:write")).toBe(true);
    expect(hasBackofficePermission(dev, "finance:view")).toBe(false);
    expect(hasBackofficePermission(dev, "billing:manage")).toBe(false);
    expect(hasBackofficePermission(dev, "team:manage")).toBe(false);
    expect(hasBackofficePermission(dev, "business:manage")).toBe(false);
    expect(hasBackofficePermission(dev, "whatsapp:view")).toBe(true);
    expect(hasBackofficePermission(dev, "creative-analysis:manage")).toBe(true);
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

  test("allows devs to access any customer user", () => {
    expect(canAccessMarketingUser(dev, "any-user")).toBe(true);
  });
});

describe("canAccessUserHubTab", () => {
  test("allows admins to access every user hub tab", () => {
    expect(canAccessUserHubTab(admin, "any-user", "summary")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "subscription")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "business")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "marketing")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "audit")).toBe(true);
    expect(canAccessUserHubTab(admin, "any-user", "whatsapp")).toBe(true);
  });

  test("limits assigned consultants to business and marketing tabs", () => {
    expect(canAccessUserHubTab(consultant, "user-1", "business")).toBe(true);
    expect(canAccessUserHubTab(consultant, "user-1", "marketing")).toBe(true);
    expect(canAccessUserHubTab(consultant, "user-1", "summary")).toBe(false);
    expect(canAccessUserHubTab(consultant, "user-1", "subscription")).toBe(
      false,
    );
    expect(canAccessUserHubTab(consultant, "user-1", "whatsapp")).toBe(false);
  });

  test("blocks consultants from unassigned user hub tabs", () => {
    expect(canAccessUserHubTab(consultant, "user-3", "business")).toBe(false);
    expect(canAccessUserHubTab(consultant, "user-3", "marketing")).toBe(false);
  });

  test("allows devs to access every user hub tab", () => {
    expect(canAccessUserHubTab(dev, "any-user", "summary")).toBe(true);
    expect(canAccessUserHubTab(dev, "any-user", "subscription")).toBe(true);
    expect(canAccessUserHubTab(dev, "any-user", "audit")).toBe(true);
    expect(canAccessUserHubTab(dev, "any-user", "whatsapp")).toBe(true);
  });
});
