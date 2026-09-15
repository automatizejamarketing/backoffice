import { describe, expect, test } from "bun:test";
import { buildMetaAssetsSelectionView } from "./meta-assets-card-data";

describe("buildMetaAssetsSelectionView", () => {
  test("absence of a policy row is no selection, not pending/initial", () => {
    expect(buildMetaAssetsSelectionView(null, "ignored")).toEqual({
      status: "none",
      reason: null,
      requestedNote: null,
      since: null,
      selectedBy: null,
      mode: null,
    });
  });

  test("a stored pending support request keeps the note and since", () => {
    expect(
      buildMetaAssetsSelectionView(
        {
          adAccountLimit: 1,
          identityLimit: 1,
          selectionStatus: "pending",
          pendingReason: "support_requested",
          pendingRequestedBy: "suporte@automatize.com",
          pendingRequestedAt: new Date("2026-09-14T18:00:00.000Z"),
          selectedAt: null,
          selectedBy: null,
          selectionMode: null,
        },
        "conta errada",
      ),
    ).toEqual({
      status: "pending",
      reason: "support_requested",
      requestedNote: "conta errada",
      since: "2026-09-14T18:00:00.000Z",
      selectedBy: null,
      mode: null,
    });
  });
});
