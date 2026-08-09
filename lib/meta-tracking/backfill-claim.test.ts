import { describe, expect, test } from "bun:test";

import {
  BACKFILL_CLAIM_TTL_MS,
  backfillClaimCutoff,
  isBackfillAccountClaimedByOther,
  isBackfillClaimLive,
  parseBackfillClaimedAt,
} from "@/lib/meta-tracking/backfill-claim";

const NOW = new Date("2026-08-09T08:00:00.000Z");

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("parseBackfillClaimedAt", () => {
  test("lê o carimbo do objeto de progresso da conta", () => {
    expect(
      parseBackfillClaimedAt({
        covered: [],
        baselineCompletedAt: null,
        claimedAt: "2026-08-09T07:55:00.000Z",
      }),
    ).toBe("2026-08-09T07:55:00.000Z");
  });

  test("progresso antigo, gravado antes do claim existir, não tem dono", () => {
    expect(parseBackfillClaimedAt({ covered: [], baselineCompletedAt: null })).toBeNull();
  });

  test("lixo no jsonb não vira claim", () => {
    expect(parseBackfillClaimedAt(null)).toBeNull();
    expect(parseBackfillClaimedAt("2026-08-09T07:55:00.000Z")).toBeNull();
    expect(parseBackfillClaimedAt({ claimedAt: 42 })).toBeNull();
    expect(parseBackfillClaimedAt({ claimedAt: "ontem à noite" })).toBeNull();
  });
});

describe("isBackfillClaimLive", () => {
  test("claim recém-carimbado está vivo", () => {
    expect(isBackfillClaimLive({ claimedAt: minutesBefore(1), now: NOW })).toBe(true);
  });

  test("claim sem dono nunca está vivo", () => {
    expect(isBackfillClaimLive({ claimedAt: null, now: NOW })).toBe(false);
  });

  test("claim expira sozinho quando o dono morre sem soltá-lo", () => {
    expect(isBackfillClaimLive({ claimedAt: minutesBefore(11), now: NOW })).toBe(false);
  });

  test("a expiração acompanha o timeout de run travado", () => {
    expect(BACKFILL_CLAIM_TTL_MS).toBe(10 * 60 * 1000);
    const exactlyAtTtl = new Date(NOW.getTime() - BACKFILL_CLAIM_TTL_MS).toISOString();
    expect(isBackfillClaimLive({ claimedAt: exactlyAtTtl, now: NOW })).toBe(false);
  });

  test("relógio do banco à frente do nosso não invalida o claim", () => {
    const future = new Date(NOW.getTime() + 30_000).toISOString();
    expect(isBackfillClaimLive({ claimedAt: future, now: NOW })).toBe(true);
  });

  test("backfillClaimCutoff é o instante a partir do qual um claim ainda vale", () => {
    expect(backfillClaimCutoff(NOW).toISOString()).toBe("2026-08-09T07:50:00.000Z");
  });
});

describe("isBackfillAccountClaimedByOther", () => {
  test("conta livre quando ninguém a carimbou", () => {
    expect(
      isBackfillAccountClaimedByOther({
        claims: [],
        ownRunId: "run-a",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("o próprio run não bloqueia a si mesmo na retomada", () => {
    expect(
      isBackfillAccountClaimedByOther({
        claims: [{ runId: "run-a", claimedAt: minutesBefore(1) }],
        ownRunId: "run-a",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("outro run vivo na mesma conta bloqueia (gatilho de conexão × dreno manual)", () => {
    expect(
      isBackfillAccountClaimedByOther({
        claims: [{ runId: "run-b", claimedAt: minutesBefore(2) }],
        ownRunId: "run-a",
        now: NOW,
      }),
    ).toBe(true);
  });

  test("claim de run morto libera a conta", () => {
    expect(
      isBackfillAccountClaimedByOther({
        claims: [{ runId: "run-b", claimedAt: minutesBefore(30) }],
        ownRunId: "run-a",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("um claim vivo entre vários mortos ainda bloqueia", () => {
    expect(
      isBackfillAccountClaimedByOther({
        claims: [
          { runId: "run-b", claimedAt: minutesBefore(45) },
          { runId: "run-c", claimedAt: null },
          { runId: "run-d", claimedAt: minutesBefore(3) },
        ],
        ownRunId: "run-a",
        now: NOW,
      }),
    ).toBe(true);
  });
});
