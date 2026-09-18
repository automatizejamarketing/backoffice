import { describe, expect, test } from "bun:test";

import { buildInboundTrail, trailStepForPhase } from "./flow-trail";

const NO_EXTRAS = {
  hasIdentityChoice: false,
  showProvenAds: false,
  needsTexts: false,
  needsLocationStep: false,
  needsPixelStep: false,
};

describe("buildInboundTrail", () => {
  test("sem etapas opcionais: objetivo, análise, orçamento, mídia e revisão", () => {
    expect(buildInboundTrail(NO_EXTRAS)).toEqual([
      "objective",
      "scanning",
      "budget",
      "media",
      "review",
    ]);
  });

  test("com escolha de identidade: a etapa entra entre orçamento e mídia", () => {
    expect(buildInboundTrail({ ...NO_EXTRAS, hasIdentityChoice: true })).toEqual([
      "objective",
      "scanning",
      "budget",
      "identity",
      "media",
      "review",
    ]);
  });

  test("todas as etapas opcionais aparecem na ordem do fluxo", () => {
    expect(
      buildInboundTrail({
        hasIdentityChoice: true,
        showProvenAds: true,
        needsTexts: true,
        needsLocationStep: true,
        needsPixelStep: true,
      }),
    ).toEqual([
      "objective",
      "scanning",
      "proven_ads",
      "budget",
      "identity",
      "media",
      "text",
      "location",
      "pixel",
      "review",
    ]);
  });
});

describe("trailStepForPhase", () => {
  test("cada fase visível marca a própria etapa", () => {
    expect(trailStepForPhase("objective")).toBe("objective");
    expect(trailStepForPhase("scanning")).toBe("scanning");
    expect(trailStepForPhase("proven_ads")).toBe("proven_ads");
    expect(trailStepForPhase("budget")).toBe("budget");
    expect(trailStepForPhase("identity")).toBe("identity");
    expect(trailStepForPhase("media")).toBe("media");
    expect(trailStepForPhase("text")).toBe("text");
    expect(trailStepForPhase("location")).toBe("location");
    expect(trailStepForPhase("pixel")).toBe("pixel");
    expect(trailStepForPhase("review")).toBe("review");
  });

  test("planning e publishing marcam a revisão", () => {
    expect(trailStepForPhase("planning")).toBe("review");
    expect(trailStepForPhase("publishing")).toBe("review");
  });
});
