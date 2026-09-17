import { describe, expect, it } from "bun:test";
import {
  buildPartnersSettingsUrl,
  isPartnerAccessPending,
  looksLikeCertificationRequired,
} from "./partner-access-status";

describe("partner-access-status", () => {
  it("builds the Partners URL and flags pending statuses", () => {
    expect(buildPartnersSettingsUrl("397")).toBe(
      "https://business.facebook.com/latest/settings/partners?business_id=397",
    );
    expect(isPartnerAccessPending("complete")).toBe(false);
    expect(isPartnerAccessPending("missing")).toBe(true);
    expect(isPartnerAccessPending(null)).toBe(true);
  });

  it("detects the certification block from Meta's help id, not from loose prose", () => {
    expect(
      looksLikeCertificationRequired(
        "Um administrador da empresa deve analisar e aceitar nossa política de não discriminação. https://www.facebook.com/business/help/338925176776440",
      ),
    ).toBe(true);
    expect(looksLikeCertificationRequired("Payment method required")).toBe(false);
    expect(looksLikeCertificationRequired(null)).toBe(false);
  });
});
