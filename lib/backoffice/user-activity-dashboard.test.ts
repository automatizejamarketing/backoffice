import { describe, expect, test } from "bun:test";
import {
  buildActiveUserStock,
  buildChurnCounts,
  fillDailyUserActivity,
  isActivePayingOnDate,
  isChurnedOnDate,
  isUserActivityCalendarDate,
  isUserActivityDaySeriesKey,
  isUserActivitySeriesKey,
  summarizeUserActivity,
} from "./user-activity-dashboard";
import { userActivityAxisScale } from "./user-activity-chart-scale";
import {
  parseUserActivitySeriesVisibility,
  serializeUserActivitySeriesVisibility,
} from "./user-activity-series";

function paying(startedAt: Date, endedAt: Date) {
  return { periods: [{ startedAt, endedAt }] };
}

describe("user activity dashboard", () => {
  test("fills missing days and accumulates total users", () => {
    expect(
      fillDailyUserActivity(
        {
          newUsers: [{ date: "2026-08-02", count: 4 }],
          newUsersPaid: [{ date: "2026-08-02", count: 1 }],
          newUsersTrial: [{ date: "2026-08-02", count: 2 }],
          activeUsers: [
            { date: "2026-08-01", count: 2 },
            { date: "2026-08-02", count: 5 },
          ],
          churn: [{ date: "2026-08-03", count: 1 }],
          usersBeforeWindow: 10,
        },
        { fromDate: "2026-08-01", throughDate: "2026-08-03" },
      ),
    ).toEqual([
      {
        date: "2026-08-01",
        newUsers: 0,
        newUsersPaid: 0,
        newUsersTrial: 0,
        totalUsers: 10,
        activeUsers: 2,
        churn: 0,
        activeUsersChange: 0,
      },
      {
        date: "2026-08-02",
        newUsers: 4,
        newUsersPaid: 1,
        newUsersTrial: 2,
        totalUsers: 14,
        activeUsers: 5,
        churn: 0,
        activeUsersChange: 3,
      },
      {
        date: "2026-08-03",
        newUsers: 0,
        newUsersPaid: 0,
        newUsersTrial: 0,
        totalUsers: 14,
        activeUsers: 0,
        churn: 1,
        activeUsersChange: -5,
      },
    ]);
  });

  test("never lets paid plus trial exceed the day's signups", () => {
    const [day] = fillDailyUserActivity(
      {
        newUsers: [{ date: "2026-08-02", count: 3 }],
        newUsersPaid: [{ date: "2026-08-02", count: 2 }],
        newUsersTrial: [{ date: "2026-08-02", count: 9 }],
        activeUsers: [],
        usersBeforeWindow: 0,
      },
      { fromDate: "2026-08-02", throughDate: "2026-08-02" },
    );

    expect(day?.newUsersPaid).toBe(2);
    expect(day?.newUsersTrial).toBe(1);
  });

  test("summarizes new users and the ending stock totals", () => {
    expect(
      summarizeUserActivity([
        {
          date: "2026-08-01",
          newUsers: 0,
          newUsersPaid: 0,
          newUsersTrial: 0,
          totalUsers: 10,
          activeUsers: 2,
          churn: 1,
          activeUsersChange: -1,
        },
        {
          date: "2026-08-02",
          newUsers: 4,
          newUsersPaid: 1,
          newUsersTrial: 2,
          totalUsers: 14,
          activeUsers: 5,
          churn: 2,
          activeUsersChange: 3,
        },
      ]),
    ).toEqual({
      newUsers: 4,
      newUsersPaid: 1,
      newUsersTrial: 2,
      totalUsers: 14,
      activeUsers: 5,
      churn: 3,
      activeUsersChange: 2,
    });
  });

  test("summarizes an empty window from the baseline total", () => {
    expect(summarizeUserActivity([])).toEqual({
      newUsers: 0,
      newUsersPaid: 0,
      newUsersTrial: 0,
      totalUsers: 0,
      activeUsers: 0,
      churn: 0,
      activeUsersChange: 0,
    });
  });

  test("accepts only real calendar dates and series keys", () => {
    expect(isUserActivityCalendarDate("2026-08-19")).toBe(true);
    expect(isUserActivityCalendarDate("2026-08-32")).toBe(false);
    expect(isUserActivitySeriesKey("activeUsers")).toBe(true);
    expect(isUserActivitySeriesKey("churn")).toBe(true);
    expect(isUserActivitySeriesKey("newUsersPaid")).toBe(false);
    expect(isUserActivityDaySeriesKey("newUsersPaid")).toBe(true);
    expect(isUserActivityDaySeriesKey("newUsersTrial")).toBe(true);
    expect(isUserActivityDaySeriesKey("newUsersActivated")).toBe(false);
    expect(isUserActivitySeriesKey("pagantes")).toBe(false);
  });

  test("matches pagantes: payment already existed and access still valid", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const annualPayer = paying(new Date("2026-05-01T12:00:00.000Z"), new Date("2026-09-01T12:00:00.000Z"));
    const expiredPayer = paying(new Date("2026-07-01T12:00:00.000Z"), new Date("2026-08-10T12:00:00.000Z"));
    const futurePayer = paying(new Date("2026-08-20T12:00:00.000Z"), new Date("2026-09-20T12:00:00.000Z"));

    expect(isActivePayingOnDate(annualPayer, "2026-08-19", now)).toBe(true);
    expect(isActivePayingOnDate(expiredPayer, "2026-08-19", now)).toBe(false);
    expect(isActivePayingOnDate(futurePayer, "2026-08-19", now)).toBe(false);
  });

  test("uses now on the current BRT day so the last point matches the card", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");

    expect(
      isActivePayingOnDate(
        paying(new Date("2026-07-01T12:00:00.000Z"), new Date("2026-08-19T17:30:00.000Z")),
        "2026-08-19",
        now,
      ),
    ).toBe(false);

    expect(
      isActivePayingOnDate(
        paying(new Date("2026-07-01T12:00:00.000Z"), new Date("2026-08-19T18:30:00.000Z")),
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
          paying(new Date("2026-08-01T12:00:00.000Z"), new Date("2026-08-10T06:00:00.000Z")),
          paying(new Date("2026-08-02T12:00:00.000Z"), new Date("2026-09-01T12:00:00.000Z")),
          paying(new Date("2026-05-01T12:00:00.000Z"), new Date("2026-09-01T12:00:00.000Z")),
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

  test("churn is the day a paying customer stops being paying", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const expiredOnTheTenth = paying(new Date("2026-07-01T12:00:00.000Z"), new Date("2026-08-10T12:00:00.000Z"));

    expect(isChurnedOnDate(expiredOnTheTenth, "2026-08-09", now)).toBe(false);
    expect(isChurnedOnDate(expiredOnTheTenth, "2026-08-10", now)).toBe(true);
    expect(isChurnedOnDate(expiredOnTheTenth, "2026-08-11", now)).toBe(false);
  });

  test("today only counts expirations that already happened", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const row = (expirationDate: string) =>
      paying(new Date("2026-07-01T12:00:00.000Z"), new Date(expirationDate));

    expect(
      isChurnedOnDate(row("2026-08-19T17:30:00.000Z"), "2026-08-19", now),
    ).toBe(true);
    expect(
      isChurnedOnDate(row("2026-08-19T18:30:00.000Z"), "2026-08-19", now),
    ).toBe(false);
  });

  test("the pagantes line drops by exactly the churn of each day", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const window = { fromDate: "2026-08-08", throughDate: "2026-08-12" };
    const users = [
      paying(new Date("2026-07-01T12:00:00.000Z"), new Date("2026-08-10T12:00:00.000Z")),
      paying(new Date("2026-07-05T12:00:00.000Z"), new Date("2026-08-10T23:00:00.000Z")),
      paying(new Date("2026-08-11T12:00:00.000Z"), new Date("2026-09-11T12:00:00.000Z")),
    ];

    expect(buildChurnCounts(users, window, now)).toEqual([
      { date: "2026-08-08", count: 0 },
      { date: "2026-08-09", count: 0 },
      { date: "2026-08-10", count: 2 },
      { date: "2026-08-11", count: 0 },
      { date: "2026-08-12", count: 0 },
    ]);
    expect(buildActiveUserStock(users, window, now)).toEqual([
      { date: "2026-08-08", count: 2 },
      { date: "2026-08-09", count: 2 },
      { date: "2026-08-10", count: 0 },
      { date: "2026-08-11", count: 1 },
      { date: "2026-08-12", count: 1 },
    ]);
  });
});

describe("user activity saldo", () => {
  test("the first day's saldo is measured against the day before the window", () => {
    const days = fillDailyUserActivity(
      {
        newUsers: [],
        activeUsers: [
          { date: "2026-08-01", count: 10 },
          { date: "2026-08-02", count: 8 },
        ],
        usersBeforeWindow: 0,
        activeUsersBeforeWindow: 7,
      },
      { fromDate: "2026-08-01", throughDate: "2026-08-02" },
    );

    expect(days.map((day) => day.activeUsersChange)).toEqual([3, -2]);
    expect(summarizeUserActivity(days).activeUsersChange).toBe(1);
  });

  test("churn stays on the day the customer left after they come back", () => {
    const now = new Date("2026-08-19T18:00:00.000Z");
    const leftAndCameBack = {
      periods: [
        {
          startedAt: new Date("2026-07-01T12:00:00.000Z"),
          endedAt: new Date("2026-08-10T12:00:00.000Z"),
        },
        {
          startedAt: new Date("2026-08-14T15:00:00.000Z"),
          endedAt: new Date("2026-09-14T15:00:00.000Z"),
        },
      ],
    };
    const window = { fromDate: "2026-08-09", throughDate: "2026-08-15" };

    expect(
      buildChurnCounts([leftAndCameBack], window, now).map((day) => day.count),
    ).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(
      buildActiveUserStock([leftAndCameBack], window, now).map(
        (day) => day.count,
      ),
    ).toEqual([1, 0, 0, 0, 0, 1, 1]);
  });
});

describe("user activity axis scale", () => {
  test("puts both zeros on the same line when there is churn", () => {
    const { daily, stock } = userActivityAxisScale({
      dailyMax: 137,
      churnMax: 4,
      stockMax: 130,
    });

    expect(daily.ticks).toEqual([0, 40, 80, 120, 160]);
    expect(stock.ticks).toEqual([0, 40, 80, 120, 160]);
    const dailyZero = -daily.domain[0] / (daily.domain[1] - daily.domain[0]);
    const stockZero = -stock.domain[0] / (stock.domain[1] - stock.domain[0]);
    expect(dailyZero).toBeGreaterThan(0);
    expect(Math.abs(stockZero - dailyZero)).toBeLessThan(1e-9);
  });

  test("keeps zero at the bottom without churn", () => {
    const { daily, stock } = userActivityAxisScale({
      dailyMax: 9,
      churnMax: 0,
      stockMax: 0,
    });

    expect(daily.domain).toEqual([0, 12]);
    expect(daily.ticks).toEqual([0, 3, 6, 9, 12]);
    expect(stock.domain[0]).toBe(0);
  });
});

describe("user activity series visibility", () => {
  test("keeps known series flags and ignores junk", () => {
    expect(parseUserActivitySeriesVisibility(null)).toEqual({
      newUsers: true,
      users: true,
      activeUsers: true,
      churn: true,
    });
    expect(
      parseUserActivitySeriesVisibility(
        serializeUserActivitySeriesVisibility({
          newUsers: false,
          users: true,
          activeUsers: false,
          churn: false,
        }),
      ),
    ).toEqual({
      newUsers: false,
      users: true,
      activeUsers: false,
      churn: false,
    });
    expect(parseUserActivitySeriesVisibility("{not-json")).toEqual({
      newUsers: true,
      users: true,
      activeUsers: true,
      churn: true,
    });
  });
});
