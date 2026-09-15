import { describe, expect, test } from "bun:test";
import type { BillingProvider } from "@/lib/db/schema";
import { buildUsersCsv } from "./users-csv";
import type { UserWithUsage } from "@/lib/db/admin-queries";

/** Provedor que o domínio não conhece mais: a coluna é varchar, não enum do banco,
 *  então uma linha antiga pode trazer qualquer string e a UI tem que degradar. */
const HISTORICAL_PROVIDER = "legacy_gateway" as BillingProvider;

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
  test("labels Stripe as Cartão, Mercado Pago as Pix, and an unknown provider as sem classificação", () => {
    expect(buildUsersCsv([userWithProvider("stripe")])).toContain("Cartão");
    expect(buildUsersCsv([userWithProvider("mercadopago")])).toContain("Pix");
    const historical = buildUsersCsv([userWithProvider(HISTORICAL_PROVIDER)]);
    expect(historical).toContain("sem classificação");
    expect(historical).not.toMatch(/legacy_gateway/i);
  });
});

describe("buildUsersCsv Meta column", () => {
  test("exports Seleção pendente and Ativo indisponível from the stored policy", () => {
    const pending = {
      ...userWithProvider("stripe"),
      hasMetaBusinessAccount: true,
      metaSelectionStatus: "pending",
      metaPendingReason: "limit_changed",
      unavailableMetaAssetCount: 0,
    } as UserWithUsage;
    const unavailable = {
      ...userWithProvider("stripe"),
      hasMetaBusinessAccount: true,
      metaSelectionStatus: "fixed",
      metaPendingReason: null,
      unavailableMetaAssetCount: 1,
    } as UserWithUsage;

    expect(buildUsersCsv([pending])).toContain("Seleção pendente");
    expect(buildUsersCsv([unavailable])).toContain("Ativo indisponível");
  });
});
