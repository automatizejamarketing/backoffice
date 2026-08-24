import { describe, expect, test } from "bun:test";

import {
  classifyTrackingIssue,
  pseudonymizeMetaIdentifier,
  safeErrorSummary,
  sanitizeMetaLogText,
} from "@/lib/observability/meta-log-safety";

describe("meta log safety", () => {
  test("pseudonimiza de forma estável sem preservar o identificador", () => {
    const first = pseudonymizeMetaIdentifier(
      "account",
      "act_998877665544332",
    );
    const second = pseudonymizeMetaIdentifier(
      "account",
      "act_998877665544332",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^account-[a-f0-9]{12}$/);
    expect(first).not.toContain("998877665544332");
  });

  test("remove e-mail, ids Meta e tokens de texto livre", () => {
    const sanitized = sanitizeMetaLogText(
      'cliente@exemplo.com act_998877665544332 238899776655443 Bearer secret-token access_token=EAAB-secret {"access_token":"EAAB-json-secret"}',
    );

    expect(sanitized).not.toContain("cliente@exemplo.com");
    expect(sanitized).not.toContain("998877665544332");
    expect(sanitized).not.toContain("238899776655443");
    expect(sanitized).not.toContain("secret-token");
    expect(sanitized).not.toContain("EAAB-secret");
    expect(sanitized).not.toContain("EAAB-json-secret");
    expect(sanitized).toContain("[REDACTED_EMAIL]");
    expect(sanitized).toContain("[REDACTED_TOKEN]");
  });

  test("limita erro enorme e preserva código, subcódigo e causa", () => {
    const cause = Object.assign(new Error("violates bind message limit"), {
      code: "08P01",
    });
    const error = Object.assign(
      new Error(
        `Failed query: insert into meta_tracking_change_events ${"x".repeat(
          2_500_000,
        )} cliente@exemplo.com act_998877665544332`,
        { cause },
      ),
      {
        errorReturn: {
          reason: { isTransient: false },
          data: {
            code: 100,
            errorSubcode: 1504044,
            fbtraceId: "trace-safe",
          },
        },
      },
    );

    const summary = safeErrorSummary(error);
    const serialized = JSON.stringify(summary);

    expect(serialized.length).toBeLessThan(5_000);
    expect(serialized).not.toContain("cliente@exemplo.com");
    expect(serialized).not.toContain("998877665544332");
    expect(summary).toMatchObject({
      code: 100,
      subcode: 1504044,
      traceId: "trace-safe",
      cause: { code: "08P01" },
    });
  });

  test("categoriza ação do cliente, transiente externo e falha interna", () => {
    expect(
      classifyTrackingIssue(
        Object.assign(new Error("token expirado"), { code: 190 }),
      ),
    ).toBe("customer_action_required");

    expect(
      classifyTrackingIssue(
        Object.assign(new Error("rate limit"), {
          errorReturn: {
            reason: { isTransient: true },
            data: { code: 4, errorSubcode: 1504022 },
          },
        }),
      ),
    ).toBe("external_transient");

    expect(classifyTrackingIssue(new Error("falha SQL"))).toBe(
      "internal_failure",
    );
    expect(
      classifyTrackingIssue(new Error("activities"), "degraded_component"),
    ).toBe("degraded_component");
  });
});
