import { describe, expect, test } from "bun:test";

import {
  creativeSkipReasonLabel,
  creativeDimensionLabel,
} from "./labels";

describe("creativeSkipReasonLabel", () => {
  test("translates persisted gate codes", () => {
    expect(creativeSkipReasonLabel("metrics_do_not_underperform")).toContain(
      "Não está pior",
    );
    expect(creativeSkipReasonLabel("insufficient_sample")).toContain("Amostra");
    expect(creativeSkipReasonLabel("is_ranking_winner")).toContain("vencedora");
  });

  test("falls back to a readable code", () => {
    expect(creativeSkipReasonLabel("new_gate_reason")).toBe("new gate reason");
  });
});

describe("creativeDimensionLabel", () => {
  test("keeps Portuguese craft names", () => {
    expect(creativeDimensionLabel("hook")).toBe("Gancho");
  });
});
