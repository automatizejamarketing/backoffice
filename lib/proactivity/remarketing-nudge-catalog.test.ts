import { describe, expect, test } from "bun:test";
import { REMARKETING_WHATSAPP_NUDGES } from "./remarketing-nudge-catalog";

describe("remarketing WhatsApp nudge catalog", () => {
  test("exposes the three frontend activation nudges as read-only", () => {
    expect(REMARKETING_WHATSAPP_NUDGES).toHaveLength(3);
    expect(REMARKETING_WHATSAPP_NUDGES.every((n) => n.editable === false)).toBe(
      true,
    );
    expect(REMARKETING_WHATSAPP_NUDGES.every((n) => n.channel === "whatsapp")).toBe(
      true,
    );
    expect(
      REMARKETING_WHATSAPP_NUDGES.map((n) => n.templateName).sort(),
    ).toEqual([
      "signup_nudge_15m_v2",
      "signup_nudge_1d_v2",
      "trial_onboarding_nudge_30m_v1",
    ].sort());
  });
});
