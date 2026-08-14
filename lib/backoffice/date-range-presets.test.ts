import { describe, expect, test } from "bun:test";
import { buildDateRangePresets } from "./date-range-presets";

const fridayAugust14 = new Date(2026, 7, 14, 12);

function calendarDate(value: Date | undefined) {
  if (!value) {
    throw new Error("expected a calendar date");
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetRange(label: string) {
  const preset = buildDateRangePresets(fridayAugust14).find(
    (item) => item.label === label,
  );

  if (!preset) {
    throw new Error(`missing preset: ${label}`);
  }

  return {
    from: calendarDate(preset.range.from),
    to: calendarDate(preset.range.to),
  };
}

describe("date range presets", () => {
  test("matches Meta Ads Manager windows from a Friday", () => {
    expect(presetRange("Hoje")).toEqual({ from: "2026-08-14", to: "2026-08-14" });
    expect(presetRange("Ontem")).toEqual({
      from: "2026-08-13",
      to: "2026-08-13",
    });
    expect(presetRange("Últimos 7 dias")).toEqual({
      from: "2026-08-08",
      to: "2026-08-14",
    });
    expect(presetRange("Hoje e ontem")).toEqual({
      from: "2026-08-13",
      to: "2026-08-14",
    });
    expect(presetRange("Esta semana")).toEqual({
      from: "2026-08-10",
      to: "2026-08-14",
    });
    expect(presetRange("Semana passada")).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(presetRange("Este mês")).toEqual({
      from: "2026-08-01",
      to: "2026-08-14",
    });
    expect(presetRange("Mês passado")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(presetRange("Este trimestre")).toEqual({
      from: "2026-07-01",
      to: "2026-08-14",
    });
    expect(presetRange("Trimestre passado")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(presetRange("Este ano")).toEqual({
      from: "2026-01-01",
      to: "2026-08-14",
    });
    expect(presetRange("Ano passado")).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });
});
