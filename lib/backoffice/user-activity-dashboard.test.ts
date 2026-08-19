import { describe, expect, test } from "bun:test";
import {
  buildActiveUserStock,
  fillDailyUserActivity,
  isActivePayingOnDate,
  isUserActivityCalendarDate,
  isUserActivityDaySeriesKey,
  isUserActivitySeriesKey,
  summarizeUserActivity,
} from "./user-activity-dashboard";
import {
  parseUserActivitySeriesVisibility,
  serializeUserActivitySeriesVisibility,
} from "./user-activity-series";

describe("user activity dashboard", () => {
  test("fills missing days and accumulates total users", () => {
    expect(
      fillDailyUserActivity(
        {
          newUsers: [{ date: "2026-08-02", count: 4 }],
          newUsersActivated: [{ date: "2026-08-02", count: 2 }],
          activeUsers: [
            { date: "2026-08-01", count: 2 },
            { date: "2026-08-02", count: 5 },
          ],
          usersBeforeWindow: 10,
        },
        { fromDate: "2026-08-01", throughDate: "2026-08-03" },
      ),
    ).toEqual([
      {
        date: "2026-08-01",
        newUsers: 0,
        newUsersActivated: 0,
        totalUsers: 10,
        activeUsers: 2,
      },
      {
        date: "2026-08-02",
        newUsers: 4,
        newUsersActivated: 2,
        totalUsers: 14,
        activeUsers: 5,
      },
      {
        date: "2026-08-03",
        newUsers: 0,
        newUsersActivated: 0,
        totalUsers: 14,
        activeUsers: 0,
      },
    ]);
  });

  test("never lets activated new users exceed the day's signups", () => {
    expect(
      fillDailyUserActivity(
        {
          newUsers: [{ date: "2026-08-02", count: 2 }],
          newUsersActivated: [{ date: "2026-08-02", count: 9 }],
          activeUsers: [],
          usersBeforeWindow: 0,
        },
        { fromDate: "2026-08-02", throughDate: "2026-08-02" },
      )[0]?.newUsersActivated,
    ).toBe(2);
  });

  test("summarizes new users and the ending stock totals", () => {
    expect(
      summarizeUserActivity([
        {
          date: "2026-08-01",
          newUsers: 0,
          newUsersActivated: 0,
          totalUsers: 10,
          activeUsers: 2,
        },
        {
          date: "2026-08-02",
          newUsers: 4,
          newUsersActivated: 2,
          totalUsers: 14,
          activeUsers: 5,
        },
      ]),
    ).toEqual({
      newUsers: 4,
      newUsersActivated: 2,
      totalUsers: 14,
      activeUsers: 5,
    });
  });

  test("summarizes an empty window from the baseline total", () => {
    expect(summarizeUserActivity([])).toEqual({
      newUsers: 0,
      newUsersActivated: 0,
      totalUsers: 0,
      activeUsers: 0,
    });
  });

  test("accepts only real calendar dates and series keys", () => {
    expect(isUserActivityCalendarDate("2026-08-19")).toBe(true);
    expect(isUserActivityCalendarDate("2026-08-32")).toBe(false);
    expect(isUserActivitySeriesKey("activeUsers")).toBe(true);
    expect(isUserActivitySeriesKey("newUsersActivated")).toBe(false);
    expect(isUserActivityDaySeriesKey("newUsersActivated")).toBe(true);
    expect(isUserActivitySeriesKey("pagantes")).toBe(false);
  });

  test("matches pagantes: payment already existed and access still valid", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const annualPayer = {
      firstPaidAt: new Date("2026-05-01T12:00:00.000Z"),
      expirationDate: new Date("2026-09-01T12:00:00.000Z"),
    };
    const expiredPayer = {
      firstPaidAt: new Date("2026-07-01T12:00:00.000Z"),
      expirationDate: new Date("2026-08-10T12:00:00.000Z"),
    };
    const futurePayer = {
      firstPaidAt: new Date("2026-08-20T12:00:00.000Z"),
      expirationDate: new Date("2026-09-20T12:00:00.000Z"),
    };

    expect(isActivePayingOnDate(annualPayer, "2026-08-19", now)).toBe(true);
    expect(isActivePayingOnDate(expiredPayer, "2026-08-19", now)).toBe(false);
    expect(isActivePayingOnDate(futurePayer, "2026-08-19", now)).toBe(false);
  });

  test("uses now on the current BRT day so the last point matches the card", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");

    expect(
      isActivePayingOnDate(
        {
          firstPaidAt: new Date("2026-07-01T12:00:00.000Z"),
          expirationDate: new Date("2026-08-19T17:30:00.000Z"),
        },
        "2026-08-19",
        now,
      ),
    ).toBe(false);

    expect(
      isActivePayingOnDate(
        {
          firstPaidAt: new Date("2026-07-01T12:00:00.000Z"),
          expirationDate: new Date("2026-08-19T18:30:00.000Z"),
        },
        "2026-08-19",
        now,
      ),
    ).toBe(true);
  });

  test("counts paying customers per day from first payment and expiration", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");

    expect(
      buildActiveUserStock(
        [
          {
            firstPaidAt: new Date("2026-08-01T12:00:00.000Z"),
            expirationDate: new Date("2026-08-10T06:00:00.000Z"),
          },
          {
            firstPaidAt: new Date("2026-08-02T12:00:00.000Z"),
            expirationDate: new Date("2026-09-01T12:00:00.000Z"),
          },
          {
            firstPaidAt: new Date("2026-05-01T12:00:00.000Z"),
            expirationDate: new Date("2026-09-01T12:00:00.000Z"),
          },
        ],
        { fromDate: "2026-08-01", throughDate: "2026-08-03" },
        now,
      ),
    ).toEqual([
      { date: "2026-08-01", count: 2 },
      { date: "2026-08-02", count: 3 },
      { date: "2026-08-03", count: 3 },
    ]);
  });
});

describe("user activity series visibility", () => {
  test("keeps known series flags and ignores junk", () => {
    expect(parseUserActivitySeriesVisibility(null)).toEqual({
      newUsers: true,
      users: true,
      activeUsers: true,
    });
    expect(
      parseUserActivitySeriesVisibility(
        serializeUserActivitySeriesVisibility({
          newUsers: false,
          users: true,
          activeUsers: false,
        }),
      ),
    ).toEqual({
      newUsers: false,
      users: true,
      activeUsers: false,
    });
    expect(parseUserActivitySeriesVisibility("{not-json")).toEqual({
      newUsers: true,
      users: true,
      activeUsers: true,
    });
  });
});
