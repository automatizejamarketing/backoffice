import { describe, expect, test } from "bun:test";
import {
  buildTrialActivationDashboard,
  formatActivationDelay,
  goalStatus,
} from "./trial-activation";
import { resolveDashboardDateWindow } from "./dashboard-date-range";

const window = resolveDashboardDateWindow(
  { range: "custom", from: "2026-08-01", to: "2026-08-03" },
  new Date("2026-08-10T12:00:00Z"),
);

describe("trial activation dashboard", () => {
  test("counts trials on the day they were activated, not on signup", () => {
    const { daily, summary } = buildTrialActivationDashboard(
      [
        {
          userId: "old-account",
          signedUpAt: new Date("2026-06-01T15:00:00Z"),
          activatedAt: new Date("2026-08-02T14:00:00Z"),
        },
        {
          userId: "same-day",
          signedUpAt: new Date("2026-08-02T13:00:00Z"),
          activatedAt: new Date("2026-08-02T13:30:00Z"),
        },
        {
          userId: "outside-window",
          signedUpAt: new Date("2026-08-04T13:00:00Z"),
          activatedAt: new Date("2026-08-04T13:30:00Z"),
        },
      ],
      window,
    );

    expect(daily.map((day) => day.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(daily[1]).toEqual({
      date: "2026-08-02",
      activations: 2,
      sameDay: 1,
      existingAccount: 1,
      avgDelaySeconds: (62 * 24 * 3600 - 3600 + 1800) / 2,
      medianDelaySeconds: (62 * 24 * 3600 - 3600 + 1800) / 2,
    });
    expect(daily[0].activations).toBe(0);
    expect(daily[0].avgDelaySeconds).toBeNull();
    expect(summary.activations).toBe(2);
    expect(summary.existingAccount).toBe(1);
    expect(summary.existingAccountRate).toBe(50);
  });

  test("uses BRT day boundaries for the activation day", () => {
    const { daily } = buildTrialActivationDashboard(
      [
        {
          userId: "late-night",
          // 23:30 BRT on Aug 1 == 02:30 UTC on Aug 2
          signedUpAt: new Date("2026-08-02T02:00:00Z"),
          activatedAt: new Date("2026-08-02T02:30:00Z"),
        },
      ],
      window,
    );

    expect(daily[0]).toMatchObject({
      date: "2026-08-01",
      activations: 1,
      sameDay: 1,
    });
  });

  test("summarizes goal adherence and window-wide delay stats", () => {
    const records = [
      ...Array.from({ length: 9 }, (_, index) => ({
        userId: `d1-${index}`,
        signedUpAt: new Date("2026-08-01T10:00:00Z"),
        activatedAt: new Date(`2026-08-01T1${index}:00:00Z`),
      })),
      ...Array.from({ length: 14 }, (_, index) => ({
        userId: `d2-${index}`,
        signedUpAt: new Date("2026-07-30T10:00:00Z"),
        activatedAt: new Date("2026-08-02T12:00:00Z"),
      })),
    ];

    const { summary } = buildTrialActivationDashboard(records, window);

    expect(summary.days).toBe(3);
    expect(summary.daysOnGoal).toBe(1);
    expect(summary.daysAboveGoal).toBe(1);
    expect(summary.daysBelowGoal).toBe(1);
    expect(summary.avgPerDay).toBe(7.7);
    expect(summary.medianDelaySeconds).toBe(3 * 24 * 3600 + 2 * 3600);
  });

  test("clamps negative delays and skips unknown signup dates", () => {
    const { daily, summary } = buildTrialActivationDashboard(
      [
        {
          userId: "skew",
          signedUpAt: new Date("2026-08-01T12:00:05Z"),
          activatedAt: new Date("2026-08-01T12:00:00Z"),
        },
        {
          userId: "no-signup",
          signedUpAt: null,
          activatedAt: new Date("2026-08-01T12:00:00Z"),
        },
      ],
      window,
    );

    expect(daily[0]).toMatchObject({
      activations: 2,
      sameDay: 1,
      existingAccount: 1,
      avgDelaySeconds: 0,
    });
    expect(summary.avgDelaySeconds).toBe(0);
  });

  test("classifies days against the 8–13 goal", () => {
    expect(goalStatus(7)).toBe("below");
    expect(goalStatus(8)).toBe("on");
    expect(goalStatus(13)).toBe("on");
    expect(goalStatus(14)).toBe("above");
  });

  test("formats activation delays in the most readable unit", () => {
    expect(formatActivationDelay(null)).toBe("—");
    expect(formatActivationDelay(30)).toBe("< 1 min");
    expect(formatActivationDelay(12 * 60)).toBe("12 min");
    expect(formatActivationDelay(5.5 * 3600)).toBe("5,5 h");
    expect(formatActivationDelay(24 * 3600)).toBe("1 dia");
    expect(formatActivationDelay(2.36 * 24 * 3600)).toBe("2,4 dias");
  });
});
