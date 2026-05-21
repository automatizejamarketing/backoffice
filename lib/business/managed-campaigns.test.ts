import { describe, expect, test } from "bun:test";
import {
  isManagedCampaignRunningNow,
  wasManagedCampaignCheckedToday,
} from "./managed-campaigns";

const now = new Date("2026-05-21T12:00:00.000Z");

describe("isManagedCampaignRunningNow", () => {
  test("does not count an active Meta campaign after its stop time", () => {
    const result = isManagedCampaignRunningNow(
      {
        name: "[AM][VENDAS] encerrada",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        start_time: "2026-04-30T17:54:30-0300",
        stop_time: "2026-05-03T23:30:00-0300",
        adsets: {
          data: [
            {
              status: "ACTIVE",
              effective_status: "ACTIVE",
              start_time: "2026-04-30T17:54:30-0300",
              end_time: "2026-05-03T23:30:00-0300",
            },
          ],
        },
      },
      "[AM]",
      now,
    );

    expect(result).toBe(false);
  });

  test("counts a prefixed active campaign with an active adset in schedule", () => {
    const result = isManagedCampaignRunningNow(
      {
        name: "[AM][VENDAS] rodando",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        start_time: "2026-05-20T17:54:30-0300",
        stop_time: "2026-05-30T23:30:00-0300",
        adsets: {
          data: [
            {
              status: "ACTIVE",
              effective_status: "ACTIVE",
              start_time: "2026-05-20T17:54:30-0300",
              end_time: "2026-05-30T23:30:00-0300",
            },
          ],
        },
      },
      "[AM]",
      now,
    );

    expect(result).toBe(true);
  });
});

describe("wasManagedCampaignCheckedToday", () => {
  test("uses the Sao Paulo business day for the daily refresh gate", () => {
    expect(
      wasManagedCampaignCheckedToday(
        new Date("2026-05-21T12:00:00.000Z"),
        new Date("2026-05-21T23:00:00.000Z"),
      ),
    ).toBe(true);
  });

  test("returns false for checks from a previous Sao Paulo day", () => {
    expect(
      wasManagedCampaignCheckedToday(
        new Date("2026-05-21T01:00:00.000Z"),
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  test("returns false when there is no previous check", () => {
    expect(wasManagedCampaignCheckedToday(null, now)).toBe(false);
  });
});
