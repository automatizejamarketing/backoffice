import { describe, expect, test } from "bun:test";

/**
 * Delivery claim semantics: first claim wins; subsequent claims for the same
 * (alertId, channel, dedupKey) are no-ops unless status is failed/provider_error.
 */
function shouldClaimDelivery(args: {
  existing: { status: string; reasonCode: string | null } | null;
}): boolean {
  if (!args.existing) return true;
  return (
    args.existing.status === "failed" &&
    args.existing.reasonCode === "provider_error"
  );
}

describe("proactivity delivery dedup", () => {
  test("claims when no prior delivery", () => {
    expect(shouldClaimDelivery({ existing: null })).toBe(true);
  });

  test("skips already sent / skipped / scheduled", () => {
    expect(
      shouldClaimDelivery({ existing: { status: "sent", reasonCode: null } }),
    ).toBe(false);
    expect(
      shouldClaimDelivery({
        existing: { status: "skipped", reasonCode: "no_phone" },
      }),
    ).toBe(false);
    expect(
      shouldClaimDelivery({
        existing: { status: "scheduled", reasonCode: null },
      }),
    ).toBe(false);
  });

  test("reclaims only provider_error failures", () => {
    expect(
      shouldClaimDelivery({
        existing: { status: "failed", reasonCode: "provider_error" },
      }),
    ).toBe(true);
    expect(
      shouldClaimDelivery({
        existing: { status: "failed", reasonCode: "template_rejected" },
      }),
    ).toBe(false);
  });
});
