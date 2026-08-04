import { describe, expect, test } from "bun:test";
import {
  fillDailyConversionCohorts,
  summarizeConversionCohorts,
} from "./conversion-dashboard";

describe("conversion dashboard", () => {
  test("fills missing cohort days with zeroes", () => {
    expect(
      fillDailyConversionCohorts(
        [
          {
            date: "2026-08-02",
            newUsers: 4,
            activated: 2,
            paid: 1,
            onboardingCompleted: 3,
          },
        ],
        { fromDate: "2026-08-01", throughDate: "2026-08-03" },
      ),
    ).toEqual([
      {
        date: "2026-08-01",
        newUsers: 0,
        activated: 0,
        paid: 0,
        onboardingCompleted: 0,
      },
      {
        date: "2026-08-02",
        newUsers: 4,
        activated: 2,
        paid: 1,
        onboardingCompleted: 3,
      },
      {
        date: "2026-08-03",
        newUsers: 0,
        activated: 0,
        paid: 0,
        onboardingCompleted: 0,
      },
    ]);
  });

  test("summarizes each milestone against the entering cohort", () => {
    expect(
      summarizeConversionCohorts([
        {
          date: "2026-08-01",
          newUsers: 3,
          activated: 2,
          paid: 1,
          onboardingCompleted: 2,
        },
        {
          date: "2026-08-02",
          newUsers: 5,
          activated: 1,
          paid: 2,
          onboardingCompleted: 4,
        },
      ]),
    ).toEqual({
      newUsers: 8,
      activated: 3,
      paid: 3,
      onboardingCompleted: 6,
      activationRate: 37.5,
      paidRate: 37.5,
      onboardingRate: 75,
    });
  });
});
