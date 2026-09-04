import { describe, expect, test } from "bun:test";
import { buildUsersCsv } from "./users-csv";
import type { UserWithUsage } from "@/lib/db/admin-queries";

function userWithProvider(
  provider: NonNullable<UserWithUsage["activeSubscription"]>["provider"],
): UserWithUsage {
  return {
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
    activeSubscription: {
      id: "sub-1",
      provider,
      planType: "monthly_pro",
      status: "active",
      currentPeriodEnd: new Date("2026-02-01T12:00:00.000Z"),
      cancelAtPeriodEnd: false,
    } as NonNullable<UserWithUsage["activeSubscription"]>,
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
  } as UserWithUsage;
}

describe("buildUsersCsv provider labels", () => {
  test("labels Stripe as Cartão, Mercado Pago as Pix, and historical Vindi as sem classificação", () => {
    expect(buildUsersCsv([userWithProvider("stripe")])).toContain("Cartão");
    expect(buildUsersCsv([userWithProvider("mercadopago")])).toContain("Pix");
    const historical = buildUsersCsv([userWithProvider("vindi")]);
    expect(historical).toContain("sem classificação");
    expect(historical).not.toMatch(/vindi/i);
  });
});
