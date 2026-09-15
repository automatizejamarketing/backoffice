import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CRM_FILTERS,
  parseCrmStoredFilters,
  serializeCrmStoredFilters,
} from "./crm-filters-storage";

describe("crm filters storage", () => {
  test("round-trips every filter", () => {
    const filters = {
      view: "list" as const,
      accountStage: "trial_ativo" as const,
      commercialStatus: "follow_up" as const,
      signup: { op: "between" as const, from: "2026-09-01", to: "2026-09-10" },
      expires: { op: "before" as const, date: "2026-09-30" },
    };
    expect(parseCrmStoredFilters(serializeCrmStoredFilters(filters))).toEqual(filters);
  });

  test("empty and broken storage fall back to the defaults", () => {
    expect(parseCrmStoredFilters(null)).toEqual(DEFAULT_CRM_FILTERS);
    expect(parseCrmStoredFilters("")).toEqual(DEFAULT_CRM_FILTERS);
    expect(parseCrmStoredFilters("{not json")).toEqual(DEFAULT_CRM_FILTERS);
    expect(parseCrmStoredFilters("[1,2]")).toEqual(DEFAULT_CRM_FILTERS);
  });

  test("drops unknown values field by field", () => {
    const parsed = parseCrmStoredFilters(
      JSON.stringify({
        view: "grid",
        accountStage: "vip",
        commercialStatus: "novo_lead",
        signup: { op: "between", from: "2026-13-01", to: "2026-09-10" },
        expires: { op: "between", from: "2026-09-30", to: "2026-09-10" },
      }),
    );
    expect(parsed).toEqual({
      view: "kanban",
      accountStage: undefined,
      commercialStatus: "novo_lead",
      signup: undefined,
      expires: { op: "between", from: "2026-09-10", to: "2026-09-30" },
    });
  });

  test("legacy ranges without an operator are dropped", () => {
    expect(
      parseCrmStoredFilters(JSON.stringify({ view: "list", signup: { from: "2026-09-01", to: "2026-09-10" } })),
    ).toEqual({ view: "list", accountStage: undefined, commercialStatus: undefined, signup: undefined, expires: undefined });
  });

  test("serializes without undefined keys so storage stays small", () => {
    expect(serializeCrmStoredFilters({ view: "kanban" })).toBe('{"view":"kanban"}');
  });
});
