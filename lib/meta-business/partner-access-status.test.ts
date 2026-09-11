import { describe, expect, it } from "bun:test";
import {
  buildPartnersSettingsUrl,
  isPartnerAccessPending,
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
});
