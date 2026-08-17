import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VINDI_PAID_OUT_OF_BAND_ACTION,
  VINDI_PIX_QR_TTL_MS,
  backofficeVindiPixEmailIdempotencyKey,
  calculateVindiAccessExtension,
  decideVindiPaidOutOfBand,
  findReusableVindiPixLink,
  presentBackofficeVindiPixLink,
  vindiBackofficeLinksToSupersede,
  vindiPixLinkExpiresAt,
} from "./backoffice-pix";

const EMV =
  "00020101021126950014BR.GOV.BCB.PIX2573spi.dev.cloud.itau.com.br/documentos/198e49c5-2330-4ad7-9d0b-967c7b5371225204000053039865802BR5923PMD Gotham NegA cios ME6009SAO PAULO62410503***50300017BR.GOV.BCB.BRCODE01051.0.063040866";

const now = new Date("2026-08-17T15:00:00.000Z");

describe("findReusableVindiPixLink", () => {
  it("reuses a pending link of the same user, plan, and amount that is still valid", () => {
    const reusable = {
      id: "link-1",
      planType: "quarterly_starter" as const,
      amount: 80100,
      status: "pending" as const,
      emvPayload: EMV,
      expiresAt: new Date("2026-08-20T15:00:00.000Z"),
    };

    assert.equal(
      findReusableVindiPixLink(
        [
          {
            ...reusable,
            id: "other-plan",
            planType: "monthly_pro",
          },
          reusable,
        ],
        {
          planType: "quarterly_starter",
          amount: 80100,
          now,
        },
      )?.id,
      "link-1",
    );
  });

  it("does not reuse an expired link or one without the EMV copia-e-cola", () => {
    assert.equal(
      findReusableVindiPixLink(
        [
          {
            id: "expired",
            planType: "quarterly_starter",
            amount: 80100,
            status: "pending",
            emvPayload: EMV,
            expiresAt: new Date("2026-08-17T14:59:59.000Z"),
          },
        ],
        { planType: "quarterly_starter", amount: 80100, now },
      ),
      null,
    );
    assert.equal(
      findReusableVindiPixLink(
        [
          {
            id: "no-emv",
            planType: "quarterly_starter",
            amount: 80100,
            status: "pending",
            emvPayload: null,
            expiresAt: new Date("2026-08-20T15:00:00.000Z"),
          },
        ],
        { planType: "quarterly_starter", amount: 80100, now },
      ),
      null,
    );
  });
});

describe("vindiBackofficeLinksToSupersede", () => {
  it("supersedes pending links whose plan or amount no longer match", () => {
    const stale = vindiBackofficeLinksToSupersede(
      [
        {
          id: "keep",
          planType: "quarterly_starter",
          amount: 80100,
          status: "pending",
        },
        {
          id: "other-plan",
          planType: "monthly_pro",
          amount: 49700,
          status: "pending",
        },
        {
          id: "other-amount",
          planType: "quarterly_starter",
          amount: 1,
          status: "pending",
        },
      ],
      { planType: "quarterly_starter", amount: 80100 },
    );

    assert.deepEqual(
      stale.map((link) => link.id),
      ["other-plan", "other-amount"],
    );
  });
});

describe("presentBackofficeVindiPixLink", () => {
  it("exposes the EMV string as the copia-e-cola the QR is drawn from", () => {
    const view = presentBackofficeVindiPixLink({
      id: "link-1",
      planType: "quarterly_starter",
      amount: 80100,
      currency: "brl",
      emvPayload: EMV,
      vindiBillId: "16020000",
      vindiChargeId: "99201",
      status: "pending",
      source: "backoffice",
      expiresAt: new Date("2026-08-24T15:00:00.000Z"),
      createdAt: new Date("2026-08-17T15:00:00.000Z"),
    });

    assert.equal(view.pixCopyPasteCode, EMV);
    assert.equal(view.initPoint, EMV);
    assert.equal(view.preferenceId, "16020000");
    assert.equal(view.planType, "quarterly_starter");
    assert.equal(view.amount, 80100);
  });
});

describe("backoffice Vindi Pix validity and email key", () => {
  it("expires the QR after the account duration of 7 days", () => {
    assert.equal(VINDI_PIX_QR_TTL_MS, 7 * 24 * 60 * 60 * 1000);
    assert.equal(
      vindiPixLinkExpiresAt(now).toISOString(),
      "2026-08-24T15:00:00.000Z",
    );
  });

  it("derives a stable Resend idempotency key from the link id", () => {
    assert.equal(
      backofficeVindiPixEmailIdempotencyKey("link-1"),
      "backoffice-vindi-pix-link:link-1",
    );
  });
});

describe("calculateVindiAccessExtension", () => {
  it("adds the full plan duration from now when there is no active balance", () => {
    const expiration = calculateVindiAccessExtension({
      currentExpiration: null,
      planType: "semiannual_starter",
      now: new Date("2026-05-14T12:00:00.000Z"),
    });
    assert.equal(expiration.toISOString(), "2026-11-14T12:00:00.000Z");
  });

  it("extends from max(expiration, now) so a future balance is not lost", () => {
    const expiration = calculateVindiAccessExtension({
      currentExpiration: new Date("2026-09-10T12:00:00.000Z"),
      planType: "monthly_starter",
      now: new Date("2026-08-03T12:00:00.000Z"),
    });
    assert.equal(expiration.toISOString(), "2026-10-10T12:00:00.000Z");
  });

  it("adds calendar months in Sao Paulo without moving the displayed day backwards", () => {
    const expiration = calculateVindiAccessExtension({
      currentExpiration: new Date("2026-08-31T02:00:00.000Z"),
      planType: "monthly_starter",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    assert.equal(expiration.toISOString(), "2026-10-01T02:00:00.000Z");
  });
});

describe("decideVindiPaidOutOfBand", () => {
  it("cancels every open Vindi bill and extends access by the billed plan", () => {
    const decision = decideVindiPaidOutOfBand({
      planType: "monthly_pro",
      currentExpiration: new Date("2026-08-10T12:00:00.000Z"),
      openLinks: [
        {
          id: "link-1",
          vindiBillId: "1601",
          planType: "quarterly_starter",
          status: "pending",
        },
      ],
      failedPaymentBillId: "1600",
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.deepEqual(decision.billIds, ["1601", "1600"]);
    assert.deepEqual(decision.linkIds, ["link-1"]);
    assert.equal(decision.planType, "quarterly_starter");
    assert.equal(decision.auditAction, VINDI_PAID_OUT_OF_BAND_ACTION);
    assert.equal(
      decision.newExpiration.toISOString(),
      "2026-11-17T12:00:00.000Z",
    );
  });

  it("uses the subscription plan when the only open bill is the failed charge", () => {
    const decision = decideVindiPaidOutOfBand({
      planType: "monthly_pro",
      currentExpiration: null,
      openLinks: [],
      failedPaymentBillId: "1600",
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.deepEqual(decision.billIds, ["1600"]);
    assert.equal(decision.planType, "monthly_pro");
  });

  it("refuses when there is no open Vindi bill to cancel", () => {
    const decision = decideVindiPaidOutOfBand({
      planType: "monthly_pro",
      currentExpiration: null,
      openLinks: [{ id: "paid", vindiBillId: "1", planType: "monthly_pro", status: "approved" }],
      failedPaymentBillId: null,
      now,
    });
    assert.deepEqual(decision, { ok: false, reason: "no_open_bill" });
  });
});
