import { describe, expect, test } from "bun:test";
import {
  formatCalendarDayInSaoPaulo,
  formatCalendarWeekdayLabel,
  formatChartDateInSaoPaulo,
  formatDateTimeInSaoPaulo,
  formatNumericDateInSaoPaulo,
  formatShortDateInSaoPaulo,
} from "./datetime-format";

/** Runs `body` with the process pinned to `tz`, restoring whatever was there. */
function withTimeZone(tz: string, body: () => void): void {
  const originalTz = process.env.TZ;
  process.env.TZ = tz;
  try {
    body();
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  }
}

describe("formatDateTimeInSaoPaulo", () => {
  test("formats UTC instants in America/Sao_Paulo regardless of runtime timezone", () => {
    withTimeZone("UTC", () => {
      // 2026-08-06T21:04:00.000Z = 18:04 in São Paulo (UTC-3)
      expect(formatDateTimeInSaoPaulo("2026-08-06T21:04:00.000Z")).toContain(
        "18:04",
      );
    });
  });
});

describe("formatCalendarWeekdayLabel", () => {
  test("includes the weekday before the day and short month", () => {
    expect(formatCalendarWeekdayLabel("2026-07-26")).toBe("dom. 26 de jul.");
  });
});

/**
 * `new Date("2026-08-01")` is midnight UTC per ECMA-262, so formatting it in
 * São Paulo used to render 31/07. Every helper here shares one parser, so the
 * guarantee is asserted across the family rather than on a single entry point.
 */
describe("calendar days keep their day", () => {
  test("formatNumericDateInSaoPaulo does not roll a bare date back a day", () => {
    expect(formatNumericDateInSaoPaulo("2026-08-01")).toBe("01/08/2026");
    expect(formatNumericDateInSaoPaulo("2026-08-25")).toBe("25/08/2026");
  });

  test("holds across month and year boundaries", () => {
    expect(formatNumericDateInSaoPaulo("2026-01-01")).toBe("01/01/2026");
    expect(formatNumericDateInSaoPaulo("2026-03-01")).toBe("01/03/2026");
    expect(formatNumericDateInSaoPaulo("2026-12-31")).toBe("31/12/2026");
  });

  test("holds whatever timezone the runtime is in", () => {
    for (const tz of ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati"]) {
      withTimeZone(tz, () => {
        expect(formatNumericDateInSaoPaulo("2026-08-01")).toBe("01/08/2026");
      });
    }
  });

  test("the chart axis labels the day it was given", () => {
    expect(formatChartDateInSaoPaulo("2026-08-01")).toBe("01 de ago.");
  });

  test("short and calendar-day helpers agree", () => {
    expect(formatShortDateInSaoPaulo("2026-08-01")).toBe("01/08/2026");
    expect(formatCalendarDayInSaoPaulo("2026-08-01")).toBe("01/08/2026");
  });
});

describe("instants are still instants", () => {
  test("a timestamp with an offset keeps its own day", () => {
    expect(formatNumericDateInSaoPaulo("2026-07-23T10:00:00-0300")).toBe(
      "23/07/2026",
    );
  });

  test("late-night UTC still lands on the São Paulo day", () => {
    // 2026-08-26T01:30Z is still 25/08 at 22:30 in São Paulo.
    expect(formatNumericDateInSaoPaulo("2026-08-26T01:30:00.000Z")).toBe(
      "25/08/2026",
    );
  });

  test("Date objects are passed through untouched", () => {
    expect(
      formatNumericDateInSaoPaulo(new Date("2026-08-06T21:04:00.000Z")),
    ).toBe("06/08/2026");
  });

  test("expiration timestamps land on the day the admin picked", () => {
    // updateUserExpirationWithAudit stores end-of-day; both plausible server
    // timezones must still render 01/08.
    expect(formatCalendarDayInSaoPaulo("2026-08-01T23:59:59.999Z")).toBe(
      "01/08/2026",
    );
    expect(formatCalendarDayInSaoPaulo("2026-08-02T02:59:59.999Z")).toBe(
      "01/08/2026",
    );
  });
});

describe("unusable input", () => {
  test("falls back instead of throwing", () => {
    expect(formatNumericDateInSaoPaulo(null)).toBe("—");
    expect(formatNumericDateInSaoPaulo(undefined)).toBe("—");
    expect(formatNumericDateInSaoPaulo("")).toBe("—");
    expect(formatNumericDateInSaoPaulo("nao-e-data")).toBe("—");
    expect(formatNumericDateInSaoPaulo("2026-13-45", "sem data")).toBe(
      "sem data",
    );
  });
});
