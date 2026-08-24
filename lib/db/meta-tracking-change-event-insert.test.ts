import { describe, expect, test } from "bun:test";

import {
  CHANGE_EVENT_BIND_PARAMETERS_PER_ROW,
  CHANGE_EVENT_INSERT_BATCH_SIZE,
  CHANGE_EVENT_INSERT_ERROR_CATEGORY,
  insertChangeEvents,
  type ChangeEventBatchWriter,
} from "@/lib/db/meta-tracking-change-event-insert";
import type { TrackingChangeEventDraft } from "@/lib/meta-tracking/compute-tracking-delta";

const POSTGRES_BIND_PARAMETER_LIMIT = 65_535;
const RUN_ID = "d6b611f1-68c7-43fa-89f0-76eaf67b8db8";
const OBSERVED_AT = new Date("2026-08-24T08:00:00Z");

function makeEvents(count: number): TrackingChangeEventDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: "8a1c0f4e-0000-4000-8000-000000000001",
    accountId: "act_998877665544332",
    entityLevel: "ad" as const,
    entityId: `ad-${index}`,
    entityName: `Anúncio ${index}`,
    campaignId: "campaign-1",
    adsetId: "adset-1",
    changeKind: "created" as const,
    changedFields: {
      effective_status: { old: null, new: "ACTIVE" },
    },
    source: "external_detected" as const,
    fromConfigVersionId: null,
    toVersionRef: null,
    occurredAt: OBSERVED_AT,
    detectedAt: OBSERVED_AT,
  }));
}

function insert(
  events: readonly TrackingChangeEventDraft[],
  writeBatch: ChangeEventBatchWriter,
  versionIdByRef: ReadonlyMap<string, string> = new Map(),
) {
  return insertChangeEvents({
    events,
    runId: RUN_ID,
    versionIdByRef,
    writeBatch,
  });
}

describe("insertChangeEvents", () => {
  test("divide 5.006 eventos em statements bem abaixo do limite do PostgreSQL", async () => {
    const batchSizes: number[] = [];
    let mappedColumnsPerRow = 0;

    const inserted = await insert(makeEvents(5_006), async (rows) => {
      batchSizes.push(rows.length);
      mappedColumnsPerRow = Math.max(
        mappedColumnsPerRow,
        Object.keys(rows[0] ?? {}).length,
      );
    });

    expect(inserted).toBe(5_006);
    expect(batchSizes).toEqual([
      500,
      500,
      500,
      500,
      500,
      500,
      500,
      500,
      500,
      500,
      6,
    ]);
    expect(mappedColumnsPerRow).toBe(CHANGE_EVENT_BIND_PARAMETERS_PER_ROW);
    expect(Math.max(...batchSizes) * mappedColumnsPerRow).toBeLessThan(
      POSTGRES_BIND_PARAMETER_LIMIT,
    );
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(
      CHANGE_EVENT_INSERT_BATCH_SIZE,
    );
  });

  test("soma chunks plain bem-sucedidos e resolve referências de versão", async () => {
    const events = makeEvents(501);
    events[0] = { ...events[0], toVersionRef: "version:first" };
    events[500] = { ...events[500], toVersionRef: "version:last" };
    const resolvedVersionIds: Array<string | null> = [];
    let batchCalls = 0;
    const writeBatch: ChangeEventBatchWriter = async (rows) => {
      batchCalls += 1;
      resolvedVersionIds.push(...rows.map((row) => row.toConfigVersionId));
    };

    const inserted = await insert(
      events,
      writeBatch,
      new Map([
        ["version:first", "version-id-1"],
        ["version:last", "version-id-2"],
      ]),
    );

    expect(inserted).toBe(501);
    expect(batchCalls).toBe(2);
    expect(resolvedVersionIds[0]).toBe("version-id-1");
    expect(resolvedVersionIds[500]).toBe("version-id-2");
  });

  test("substitui SQL e parâmetros gigantes por categoria e causa segura", async () => {
    const driverCause = Object.assign(
      new Error("bind message supplies 75090 parameters, but prepared statement requires 0"),
      { code: "08P01" },
    );
    const ormError = new Error(
      `Failed query: insert into meta_tracking_change_events\nparams: ${"sensitive-value,".repeat(150_000)}`,
      { cause: driverCause },
    );

    const caught = await insert(makeEvents(5_006), async () => {
      throw ormError;
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & {
      category?: string;
      cause?: Error & { code?: string };
    };
    expect(error.message.length).toBeLessThan(1_000);
    expect(error.category).toBe(CHANGE_EVENT_INSERT_ERROR_CATEGORY);
    expect(error.message).toContain("08P01");
    expect(error.message).toContain(
      "Bind parameter count mismatch (supplied 75090, expected 0).",
    );
    expect(error.message).not.toContain("Failed query:");
    expect(error.message).not.toContain("sensitive-value");
    expect(error.cause?.message).toContain("Bind parameter count mismatch");
    expect(error.cause?.code).toBe("08P01");
    expect(error.stack).not.toContain("sensitive-value");
    expect(error.cause?.stack).not.toContain("sensitive-value");
  });

  test("redige PII, ids, tokens, SQL e parâmetros de causa não-Error", async () => {
    const driverCause = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "events_account_email_key". ' +
        "Detail: Key (account_id, email, access_token)=" +
        "(act_123456789012345, pessoa@example.com, EAABsuperSecretToken123) " +
        "already exists. statement=INSERT INTO meta_tracking_change_events VALUES (...) " +
        "params=[act_123456789012345,pessoa@example.com,EAABsuperSecretToken123]",
    };
    const ormError = new Error(
      "Failed query: INSERT INTO meta_tracking_change_events VALUES ($1, $2, $3)\n" +
        "params: act_123456789012345,pessoa@example.com,EAABsuperSecretToken123",
      { cause: driverCause },
    );

    const caught = await insert(makeEvents(1), async () => {
      throw ormError;
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & {
      category?: string;
      cause?: Error & { code?: string };
    };
    const exposed = [
      error.message,
      error.stack,
      error.cause?.message,
      error.cause?.stack,
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n");

    expect(error.category).toBe(CHANGE_EVENT_INSERT_ERROR_CATEGORY);
    expect(error.cause?.code).toBe("23505");
    expect(exposed).toContain("Unique constraint violation.");
    expect(exposed.length).toBeLessThan(2_000);
    expect(exposed).not.toContain("duplicate key value");
    expect(exposed).not.toContain("pessoa@example.com");
    expect(exposed).not.toContain("act_123456789012345");
    expect(exposed).not.toContain("EAABsuperSecretToken123");
    expect(exposed).not.toContain("events_account_email_key");
    expect(exposed).not.toContain("INSERT INTO");
    expect(exposed).not.toContain("params:");
  });
});
