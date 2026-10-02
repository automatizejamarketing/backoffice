import { describe, expect, test } from "bun:test";
import { APPLY_FAILED_FIELD } from "@/lib/meta-tracking/internal-change-event";
import { countsAsPlatformAdjustment } from "./platform-adjustments";

describe("countsAsPlatformAdjustment", () => {
  test("conta alteração aplicada pelo cliente ou pelo backoffice", () => {
    expect(countsAsPlatformAdjustment("frontend_user", { status: { old: "PAUSED", new: "ACTIVE" } })).toBe(true);
    expect(countsAsPlatformAdjustment("backoffice_admin", {})).toBe(true);
  });

  test("ignora primeira leitura, status da Meta e edição no Gerenciador", () => {
    expect(countsAsPlatformAdjustment("external_detected", {})).toBe(false);
    expect(countsAsPlatformAdjustment("system", { status: { old: null, new: "ACTIVE" } })).toBe(false);
  });

  test("ignora tentativa que a Meta recusou", () => {
    expect(
      countsAsPlatformAdjustment("frontend_user", {
        daily_budget: { old: "1000", new: "2000" },
        [APPLY_FAILED_FIELD]: { old: null, new: "recusou" },
      }),
    ).toBe(false);
  });
});
