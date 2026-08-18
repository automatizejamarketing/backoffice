import { describe, expect, test } from "bun:test";
import { summarizePayerRetentionCohorts } from "./payer-retention";

describe("payer retention cohorts", () => {
  test("summarizes weekly first-payment cohorts against active access today", () => {
    expect(
      summarizePayerRetentionCohorts(
        [
          {
            weekStart: "2026-08-10",
            initialPayers: 8,
            activeToday: 6,
          },
          {
            weekStart: "2026-08-03",
            initialPayers: 4,
            activeToday: 1,
          },
        ],
        [
          {
            weekStart: "2026-08-10",
            ageWeeks: 0,
            retainedPayers: 8,
          },
          {
            weekStart: "2026-08-10",
            ageWeeks: 1,
            retainedPayers: 6,
          },
          {
            weekStart: "2026-08-03",
            ageWeeks: 0,
            retainedPayers: 4,
          },
        ],
      ),
    ).toEqual({
      cohorts: [
        {
          weekStart: "2026-08-10",
          initialPayers: 8,
          activeToday: 6,
          inactiveToday: 2,
          retentionRate: 75,
          retention: [
            {
              weekStart: "2026-08-10",
              ageWeeks: 0,
              retainedPayers: 8,
              initialPayers: 8,
              retentionRate: 100,
            },
            {
              weekStart: "2026-08-10",
              ageWeeks: 1,
              retainedPayers: 6,
              initialPayers: 8,
              retentionRate: 75,
            },
          ],
        },
        {
          weekStart: "2026-08-03",
          initialPayers: 4,
          activeToday: 1,
          inactiveToday: 3,
          retentionRate: 25,
          retention: [
            {
              weekStart: "2026-08-03",
              ageWeeks: 0,
              retainedPayers: 4,
              initialPayers: 4,
              retentionRate: 100,
            },
          ],
        },
      ],
      totalPayers: 12,
      activeToday: 7,
      retentionRate: 58.3,
    });
  });

  test("keeps an empty history at zero", () => {
    expect(summarizePayerRetentionCohorts([])).toEqual({
      cohorts: [],
      totalPayers: 0,
      activeToday: 0,
      retentionRate: 0,
    });
  });
});
