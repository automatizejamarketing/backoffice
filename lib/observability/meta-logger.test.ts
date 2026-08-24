import { describe, expect, test } from "bun:test";

import { runWithMetaLogContext } from "@/lib/observability/meta-log-context";
import {
  classifyMetaCall,
  logMetaCall,
  redactUrl,
  sanitizeMetaParams,
} from "@/lib/observability/meta-logger";

describe("meta logger", () => {
  test("sanitiza URL, parâmetros, ator e ids relacionados", () => {
    const rawAccountId = "act_998877665544332";
    const rawEntityId = "238899776655443";
    const rawEmail = "cliente@exemplo.com";
    const rawToken = "EAAB-super-secret";

    expect(
      redactUrl(
        `https://graph.facebook.com/v25.0/${rawAccountId}/insights?access_token=${rawToken}`,
      ),
    ).not.toContain(rawAccountId);

    const params = JSON.stringify(
      sanitizeMetaParams({
        accessToken: rawToken,
        accountId: rawAccountId,
        ids: `${rawEntityId},112233445566778`,
        email: rawEmail,
      }),
    );
    expect(params).not.toContain(rawToken);
    expect(params).not.toContain(rawAccountId);
    expect(params).not.toContain(rawEntityId);
    expect(params).not.toContain(rawEmail);

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      runWithMetaLogContext(
        {
          correlationId: "correlation-safe",
          app: "backoffice",
          route: "/api/cron-job/meta-tracking/daily",
          actor: {
            kind: "frontend",
            userId: "8a1c0f4e-0000-4000-8000-000000000001",
            email: rawEmail,
          },
          parentIds: { adAccountId: rawAccountId },
        },
        () =>
          logMetaCall({
            phase: "success",
            method: "GET",
            endpoint: `https://graph.facebook.com/v25.0/${rawAccountId}/insights`,
            requestParams: `level=ad&ids=${rawEntityId}`,
            entityId: rawEntityId,
          }),
      );
    } finally {
      console.log = originalLog;
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(rawAccountId);
    expect(lines[0]).not.toContain(rawEntityId);
    expect(lines[0]).not.toContain(rawEmail);
  });

  test("classifica leituras de Insights e listagens sem unknown", () => {
    expect(
      classifyMetaCall(
        "GET",
        "https://graph.facebook.com/v25.0/act_123/insights",
        "level=ad&fields=ad_id,spend",
      ),
    ).toEqual({ entity: "ad", operation: "insights" });

    expect(
      classifyMetaCall(
        "GET",
        "https://graph.facebook.com/v25.0/act_123/campaigns",
      ),
    ).toEqual({ entity: "campaign", operation: "list" });
  });

  test("amostra sucessos do coletor e nunca amostra erros", () => {
    const infoLines: string[] = [];
    const errorLines: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => infoLines.push(args.join(" "));
    console.error = (...args: unknown[]) => errorLines.push(args.join(" "));
    try {
      runWithMetaLogContext(
        {
          correlationId: "sampling-test",
          app: "backoffice",
          route: "/api/cron-job/meta-tracking/daily",
        },
        () => {
          for (let i = 0; i < 30; i += 1) {
            logMetaCall({
              phase: "success",
              method: "GET",
              endpoint:
                "https://graph.facebook.com/v25.0/act_123/insights",
              requestParams: "level=campaign",
              sampleSuccess: true,
            });
          }
          for (let i = 0; i < 3; i += 1) {
            logMetaCall({
              phase: "error",
              method: "GET",
              endpoint:
                "https://graph.facebook.com/v25.0/act_123/insights",
              requestParams: "level=campaign",
              errorData: {
                error: { message: "temporário", code: 2, is_transient: true },
              },
            });
          }
        },
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(infoLines).toHaveLength(2);
    expect(errorLines).toHaveLength(3);
  });
});
