import { afterEach, describe, expect, test } from "bun:test";

import {
  COLLECTION_DEADLINE_ERROR_CODE,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import {
  fetchAccountActivities,
  fetchTrackedAdAccounts,
  listTrackedEntities,
} from "@/lib/meta-tracking/graph-collector-gateway";

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Graph collector deadline", () => {
  test("fetch pendurado recebe AbortSignal do deadline absoluto", async () => {
    const startedAt = new Date("2026-08-24T05:00:00.000Z");
    const workDeadlineAt = new Date(startedAt.getTime() + 6_000);
    let clock = startedAt.getTime();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null = null;

    const deadline: CollectionDeadline = {
      startedAt,
      workDeadlineAt,
      finalizationDeadlineAt: new Date(workDeadlineAt.getTime() + 30_000),
      signal: controller.signal,
      now: () => new Date(clock),
      remainingWorkMs: () => workDeadlineAt.getTime() - clock,
      remainingFinalizationMs: () =>
        workDeadlineAt.getTime() + 30_000 - clock,
      dispose: () => undefined,
    };

    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener(
          "abort",
          () => reject(receivedSignal?.reason),
          { once: true },
        );
        queueMicrotask(() => {
          clock = workDeadlineAt.getTime();
          controller.abort(new Error("deadline de teste"));
        });
      });
    }) as typeof fetch;

    await expect(
      fetchTrackedAdAccounts({
        accountIds: ["act_123"],
        credentials: { accessToken: "token-de-teste" },
        deadline,
      }),
    ).rejects.toMatchObject({ code: COLLECTION_DEADLINE_ERROR_CODE });
    expect(receivedSignal).toBe(deadline.signal);
  });
});

describe("graph collector pagination integrity", () => {
  test("marca o nível de listagem que ainda tem página após o teto", async () => {
    const calls = { campaign: 0, adset: 0, ad: 0 };
    console.log = () => {};
    globalThis.fetch = (async (input) => {
      const pathname = new URL(String(input)).pathname;
      const level = pathname.endsWith("/campaigns")
        ? "campaign"
        : pathname.endsWith("/adsets")
          ? "adset"
          : "ad";
      calls[level] += 1;
      const hasNext = level === "campaign";

      return jsonResponse({
        data: [
          {
            id: `${level}-${calls[level]}`,
            name: level,
            status: "ACTIVE",
            effective_status: "ACTIVE",
          },
        ],
        ...(hasNext
          ? {
              paging: {
                next: "https://graph.facebook.com/next",
                cursors: { after: `cursor-${calls[level]}` },
              },
            }
          : {}),
      });
    }) as typeof fetch;

    const result = await listTrackedEntities({
      accountId: "act_998877665544332",
      credentials: { accessToken: "test-token" },
    });

    expect(calls).toEqual({ campaign: 25, adset: 1, ad: 1 });
    expect(result.apiCalls).toBe(27);
    expect(result.truncatedLevels).toEqual(["campaign"]);
  });

  test("marca activities truncado quando a página 25 ainda aponta continuação", async () => {
    let calls = 0;
    console.log = () => {};
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({
        data: [],
        paging: {
          next: "https://graph.facebook.com/next",
          cursors: { after: `cursor-${calls}` },
        },
      });
    }) as typeof fetch;

    const result = await fetchAccountActivities({
      accountId: "act_998877665544332",
      credentials: { accessToken: "test-token" },
      since: new Date("2026-08-22T00:00:00Z"),
      until: new Date("2026-08-24T00:00:00Z"),
    });

    expect(calls).toBe(25);
    expect(result.apiCalls).toBe(25);
    expect(result.paginationTruncated).toBe(true);
  });
});
