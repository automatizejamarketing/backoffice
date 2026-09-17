import { describe, expect, test } from "bun:test";
import {
  hashWhatsappSupportActivationCode,
  isWhatsappSupportDuration,
  normalizeSupportPhoneE164,
  normalizeWhatsappSupportReason,
  resolveWhatsappSupportEnvironment,
} from "./whatsapp-support-session-core";

describe("WhatsApp support session core", () => {
  test("normalizes Brazilian phones to E.164", () => {
    expect(normalizeSupportPhoneE164("(11) 99999-8888")).toBe(
      "+5511999998888",
    );
    expect(normalizeSupportPhoneE164("+55 11 99999-8888")).toBe(
      "+5511999998888",
    );
    expect(normalizeSupportPhoneE164("123")).toBeNull();
  });

  test("accepts only bounded duration and reason", () => {
    expect(isWhatsappSupportDuration(30)).toBe(true);
    expect(isWhatsappSupportDuration(120)).toBe(false);
    expect(normalizeWhatsappSupportReason("Validar incidente do cliente")).toBe(
      "Validar incidente do cliente",
    );
    expect(normalizeWhatsappSupportReason("curto")).toBeNull();
  });

  test("requires a recognized deployed environment", () => {
    expect(
      resolveWhatsappSupportEnvironment({
        APP_ENV: "staging",
        VERCEL: "1",
      }),
    ).toBe("staging");
    expect(
      resolveWhatsappSupportEnvironment({ APP_ENV: "prod" }),
    ).toBeNull();
  });

  test("does not persist the activation code itself", () => {
    const hash = hashWhatsappSupportActivationCode(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "123456",
    );
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("123456");
  });
});
