import { describe, expect, test } from "bun:test";
import {
  fillDailyConversionCohorts,
  summarizeCohortOutcomes,
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
            onboardingCompleted: 3,
            metaConnected: 2,
            trialStarted: 2,
            paid: 1,
          },
        ],
        { fromDate: "2026-08-01", throughDate: "2026-08-03" },
      ),
    ).toEqual([
      {
        date: "2026-08-01",
        newUsers: 0,
        onboardingCompleted: 0,
        metaConnected: 0,
        trialStarted: 0,
        paid: 0,
      },
      {
        date: "2026-08-02",
        newUsers: 4,
        onboardingCompleted: 3,
        metaConnected: 2,
        trialStarted: 2,
        paid: 1,
      },
      {
        date: "2026-08-03",
        newUsers: 0,
        onboardingCompleted: 0,
        metaConnected: 0,
        trialStarted: 0,
        paid: 0,
      },
    ]);
  });

  test("summarizes each milestone against the entering cohort", () => {
    expect(
      summarizeConversionCohorts([
        {
          date: "2026-08-01",
          newUsers: 3,
          onboardingCompleted: 2,
          metaConnected: 2,
          trialStarted: 2,
          paid: 1,
        },
        {
          date: "2026-08-02",
          newUsers: 5,
          onboardingCompleted: 4,
          metaConnected: 1,
          trialStarted: 3,
          paid: 2,
        },
      ]),
    ).toEqual({
      newUsers: 8,
      onboardingCompleted: 6,
      metaConnected: 3,
      trialStarted: 5,
      paid: 3,
      onboardingRate: 75,
      metaConnectionRate: 37.5,
      trialStartedRate: 62.5,
      paidRate: 37.5,
    });
  });

  test("summarizes cohort trial and churn rates", () => {
    expect(summarizeCohortOutcomes(2, 1, 8)).toEqual({
      trial: 2,
      churn: 1,
      trialRate: 25,
      churnRate: 12.5,
    });
  });
});
