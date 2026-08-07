import { describe, expect, it } from "vitest";
import { buildUsersCsv, escapeCsvCell } from "@/lib/backoffice/users-csv";
import type { UserWithUsage } from "@/lib/db/admin-queries";

describe("escapeCsvCell", () => {
  it("quotes values with commas", () => {
    expect(escapeCsvCell("Acme, Inc")).toBe('"Acme, Inc"');
  });

  it("escapes double quotes", () => {
    expect(escapeCsvCell('Say "hello"')).toBe('"Say ""hello"""');
  });

  it("returns empty string for nullish values", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
});

describe("buildUsersCsv", () => {
  it("includes header and user row", () => {
    const users = [
      {
        id: "user-1",
        email: "user@example.com",
        name: "User Name",
        phone: "11999998888",
        credits: 10,
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
        expirationDate: new Date("2026-02-01T12:00:00.000Z"),
        companyName: "Acme",
        onboardingCompleted: true,
        postCount: 2,
        requestCount: 3,
        totalTokens: 100,
        totalCost: 0.1234,
        activeSubscription: null,
        hasMetaBusinessAccount: false,
        metaAccountName: null,
        metaUpdatedAt: null,
        assignedConsultantId: null,
        assignedConsultantEmail: null,
        assignedConsultantName: null,
        hasActiveManagedCampaign: false,
        managedCampaignCheckedAt: null,
        renewalAlert: null,
        performanceDrop: {
          hasDrop: false,
          wasChecked: false,
          checkFailed: false,
          openInsightCount: 0,
          highestSeverity: null,
        },
      } as UserWithUsage,
    ];

    const csv = buildUsersCsv(users);
    expect(csv.startsWith("\uFEFFEmail,Nome,Empresa")).toBe(true);
    expect(csv).toContain("user@example.com");
    expect(csv).toContain("Acme");
  });
});
