import { describe, expect, test } from "bun:test";
import { buildPaidAccessPeriods } from "./paid-access-periods";

const at = (value: string) => new Date(value);

function periods(input: Parameters<typeof buildPaidAccessPeriods>[0]) {
  return buildPaidAccessPeriods(input).map((period) => [
    period.startedAt.toISOString(),
    period.endedAt.toISOString(),
  ]);
}

describe("buildPaidAccessPeriods", () => {
  test("without history, reads access the way the dashboard always did", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: at("2026-09-01T12:00:00.000Z"),
        changes: [],
      }),
    ).toEqual([["2026-07-01T12:00:00.000Z", "2026-09-01T12:00:00.000Z"]]);
  });

  test("a renewal before expiring keeps one period", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: at("2026-09-01T12:00:00.000Z"),
        changes: [
          {
            changedAt: at("2026-07-30T10:00:00.000Z"),
            previousExpirationDate: at("2026-08-01T12:00:00.000Z"),
            expirationDate: at("2026-09-01T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([["2026-07-01T12:00:00.000Z", "2026-09-01T12:00:00.000Z"]]);
  });

  test("renewing after the grace splits into two periods", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: at("2026-09-20T12:00:00.000Z"),
        changes: [
          {
            changedAt: at("2026-08-20T12:00:00.000Z"),
            previousExpirationDate: at("2026-08-01T12:00:00.000Z"),
            expirationDate: at("2026-09-20T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([
      ["2026-07-01T12:00:00.000Z", "2026-08-01T12:00:00.000Z"],
      ["2026-08-20T12:00:00.000Z", "2026-09-20T12:00:00.000Z"],
    ]);
  });

  test("paying late within the grace is not a break", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: at("2026-09-03T12:00:00.000Z"),
        changes: [
          {
            changedAt: at("2026-08-03T12:00:00.000Z"),
            previousExpirationDate: at("2026-08-01T12:00:00.000Z"),
            expirationDate: at("2026-09-03T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([["2026-07-01T12:00:00.000Z", "2026-09-03T12:00:00.000Z"]]);
  });

  test("access cut short by a change ends at the change", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: at("2026-08-05T09:00:00.000Z"),
        changes: [
          {
            changedAt: at("2026-08-05T09:00:00.000Z"),
            previousExpirationDate: at("2026-09-01T12:00:00.000Z"),
            expirationDate: at("2026-08-05T09:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([["2026-07-01T12:00:00.000Z", "2026-08-05T09:00:00.000Z"]]);
  });

  test("a trial before the first payment is not paid access", () => {
    expect(
      periods({
        firstPaidAt: at("2026-08-20T12:00:00.000Z"),
        currentExpirationDate: at("2026-09-20T12:00:00.000Z"),
        changes: [
          {
            changedAt: at("2026-07-01T12:00:00.000Z"),
            previousExpirationDate: null,
            expirationDate: at("2026-07-08T12:00:00.000Z"),
          },
          {
            changedAt: at("2026-08-20T12:00:00.000Z"),
            previousExpirationDate: at("2026-07-08T12:00:00.000Z"),
            expirationDate: at("2026-09-20T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([["2026-08-20T12:00:00.000Z", "2026-09-20T12:00:00.000Z"]]);
  });

  test("clearing the expiration ends access", () => {
    expect(
      periods({
        firstPaidAt: at("2026-07-01T12:00:00.000Z"),
        currentExpirationDate: null,
        changes: [
          {
            changedAt: at("2026-07-20T12:00:00.000Z"),
            previousExpirationDate: at("2026-08-01T12:00:00.000Z"),
            expirationDate: null,
          },
        ],
      }),
    ).toEqual([["2026-07-01T12:00:00.000Z", "2026-07-20T12:00:00.000Z"]]);
  });
});
