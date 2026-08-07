import { describe, expect, test } from "bun:test";
import { formatDateTimeInSaoPaulo } from "./datetime-format";

describe("formatDateTimeInSaoPaulo", () => {
  test("formats UTC instants in America/Sao_Paulo regardless of runtime timezone", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      // 2026-08-06T21:04:00.000Z = 18:04 in São Paulo (UTC-3)
      expect(formatDateTimeInSaoPaulo("2026-08-06T21:04:00.000Z")).toContain(
        "18:04",
      );
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});
