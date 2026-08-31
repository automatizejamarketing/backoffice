import { describe, expect, test } from "bun:test";

import {
  creativeSkipReasonLabel,
  creativeDimensionLabel,
  normalizeCreativeErrorCode,
} from "./labels";

describe("creativeSkipReasonLabel", () => {
  test("translates persisted gate codes", () => {
    expect(creativeSkipReasonLabel("metrics_do_not_underperform")).toContain(
      "Não está pior",
    );
    expect(creativeSkipReasonLabel("insufficient_sample")).toContain("Amostra");
    expect(creativeSkipReasonLabel("is_ranking_winner")).toContain("vencedora");
    expect(creativeSkipReasonLabel("no_fair_comparator")).toContain("2 irmãos");
  });

  test("falls back to a readable code", () => {
    expect(creativeSkipReasonLabel("new_gate_reason")).toBe("new gate reason");
  });

  test("maps Graph permission copy to a stable code", () => {
    expect(
      normalizeCreativeErrorCode(
        "O usuário não tem permissão para realizar esta ação.",
      ),
    ).toBe("media_permission_denied");
    expect(
      normalizeCreativeErrorCode(
        "winning-creatives: live creative refresh failed for 1985776498804715",
      ),
    ).toBe("media_permission_denied");
    expect(
      normalizeCreativeErrorCode("https://secret-host.internal?token=abc"),
    ).toBe("processing_failed");
  });
});

describe("creativeDimensionLabel", () => {
  test("keeps Portuguese craft names", () => {
    expect(creativeDimensionLabel("hook")).toBe("Gancho");
  });
});
