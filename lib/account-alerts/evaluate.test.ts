import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_RULE_CARD_PAYMENT_FAILED,
  ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN,
  ACCOUNT_RULE_PIX_EXPIRING,
  ACCOUNT_RULE_RECENTLY_CANCELED,
} from "./constants";
import {
  DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
  evaluateAccountAlerts,
  type AccountAlertSubject,
} from "./evaluate";

const enabled = new Set([
  ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN,
  ACCOUNT_RULE_PIX_EXPIRING,
  ACCOUNT_RULE_CARD_PAYMENT_FAILED,
  ACCOUNT_RULE_RECENTLY_CANCELED,
]);

function subject(
  patch: Partial<AccountAlertSubject> = {},
): AccountAlertSubject {
  return {
    userId: "user-1",
    clientName: "Padaria",
    hasActiveAccess: true,
    hasMeta: true,
    campaignChecked: true,
    hasActiveManagedCampaign: true,
    lastPaymentIsPix: false,
    daysUntilExpiration: 20,
    subscriptionProvider: "stripe",
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    daysSinceCanceled: null,
    daysSinceCardFailure: null,
    cardFailureReason: null,
    ...patch,
  };
}

function ruleIds(patch: Partial<AccountAlertSubject> = {}) {
  return evaluateAccountAlerts({
    subject: subject(patch),
    thresholds: DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
    enabledRuleIds: enabled,
  }).map((candidate) => candidate.ruleId);
}

describe("evaluateAccountAlerts", () => {
  test("healthy card subscriber produces nothing", () => {
    expect(ruleIds()).toEqual([]);
  });

  test("flags a checked account with Meta and no active managed campaign", () => {
    expect(
      ruleIds({ hasActiveManagedCampaign: false }),
    ).toEqual([ACCOUNT_RULE_NO_ACTIVE_CAMPAIGN]);
  });

  test("skips the campaign alert until the account has been checked", () => {
    expect(
      ruleIds({ hasActiveManagedCampaign: false, campaignChecked: false }),
    ).toEqual([]);
  });

  test("PIX inside the attention window warns, and inside 3 days is critical", () => {
    const warning = evaluateAccountAlerts({
      subject: subject({
        lastPaymentIsPix: true,
        subscriptionProvider: "mercadopago",
        daysUntilExpiration: 6,
      }),
      thresholds: DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
      enabledRuleIds: enabled,
    });
    expect(warning.map((row) => row.ruleId)).toEqual([ACCOUNT_RULE_PIX_EXPIRING]);
    expect(warning[0]?.severity).toBe("warning");

    const critical = evaluateAccountAlerts({
      subject: subject({
        lastPaymentIsPix: true,
        subscriptionProvider: "mercadopago",
        daysUntilExpiration: 2,
      }),
      thresholds: DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
      enabledRuleIds: enabled,
    });
    expect(critical[0]?.severity).toBe("critical");
  });

  test("does not warn PIX when the renewal is still far", () => {
    expect(
      ruleIds({
        lastPaymentIsPix: true,
        subscriptionProvider: "mercadopago",
        daysUntilExpiration: 12,
      }),
    ).toEqual([]);
  });

  test("PIX past_due stays a PIX alert, not a card failure", () => {
    expect(
      ruleIds({
        lastPaymentIsPix: true,
        subscriptionProvider: "mercadopago",
        subscriptionStatus: "past_due",
        daysUntilExpiration: 2,
      }),
    ).toEqual([ACCOUNT_RULE_PIX_EXPIRING]);
  });

  test("card past_due is a payment failure", () => {
    expect(ruleIds({ subscriptionStatus: "past_due" })).toEqual([
      ACCOUNT_RULE_CARD_PAYMENT_FAILED,
    ]);
  });

  test("a failed card charge newer than the last success is a payment failure", () => {
    const rows = evaluateAccountAlerts({
      subject: subject({
        daysSinceCardFailure: 1,
        cardFailureReason: "card_declined",
      }),
      thresholds: DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
      enabledRuleIds: enabled,
    });
    expect(rows.map((row) => row.ruleId)).toEqual([
      ACCOUNT_RULE_CARD_PAYMENT_FAILED,
    ]);
    expect(rows[0]?.evidence).toContain("card_declined");
  });

  test("an old card failure outside the lookback stays quiet", () => {
    expect(ruleIds({ daysSinceCardFailure: 30 })).toEqual([]);
  });

  test("scheduled cancel while access remains is a retention alert, not a PIX chase", () => {
    expect(
      ruleIds({
        lastPaymentIsPix: true,
        subscriptionProvider: "mercadopago",
        daysUntilExpiration: 2,
        cancelAtPeriodEnd: true,
        subscriptionStatus: "active",
      }),
    ).toEqual([ACCOUNT_RULE_RECENTLY_CANCELED]);
  });

  test("canceled within the lookback is recent", () => {
    expect(
      ruleIds({
        hasActiveAccess: false,
        subscriptionStatus: "canceled",
        daysSinceCanceled: 4,
        daysUntilExpiration: -1,
      }),
    ).toEqual([ACCOUNT_RULE_RECENTLY_CANCELED]);
  });

  test("canceled long ago is not recent", () => {
    expect(
      ruleIds({
        hasActiveAccess: false,
        subscriptionStatus: "canceled",
        daysSinceCanceled: 40,
      }),
    ).toEqual([]);
  });

  test("disabled rules stay silent", () => {
    expect(
      evaluateAccountAlerts({
        subject: subject({
          hasActiveManagedCampaign: false,
          subscriptionStatus: "past_due",
        }),
        thresholds: DEFAULT_ACCOUNT_ALERT_THRESHOLDS,
        enabledRuleIds: new Set(),
      }),
    ).toEqual([]);
  });
});
