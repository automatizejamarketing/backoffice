/**
 * The AI flow's screens and the breadcrumb ("trail") drawn over them. Pure: the client component
 * decides WHICH optional steps apply and this module only orders them.
 *
 * The backoffice never asks for the ad account — the marketing workspace already picked it — so
 * there is no `choose_account` here, unlike the frontend's copy of this flow.
 */

export type Phase =
  | "objective"
  | "scanning"
  | "proven_ads"
  | "budget"
  // Only when the account has 2+ selectable identities — with one there is nothing to ask, and the
  // silent default is kept. Sits BEFORE media so the Instagram picker opens on the right profile.
  | "identity"
  | "media"
  | "text"
  // Fallback-only, and only when the account cannot answer them itself.
  | "location"
  | "pixel"
  | "planning"
  | "review"
  | "publishing";

export type TrailStep =
  | "objective"
  | "scanning"
  | "proven_ads"
  | "budget"
  | "identity"
  | "media"
  | "text"
  | "location"
  | "pixel"
  | "review";

export function buildInboundTrail(input: {
  hasIdentityChoice: boolean;
  showProvenAds: boolean;
  needsTexts: boolean;
  needsLocationStep: boolean;
  needsPixelStep: boolean;
}): TrailStep[] {
  const steps: TrailStep[] = ["objective", "scanning"];
  if (input.showProvenAds) steps.push("proven_ads");
  steps.push("budget");
  if (input.hasIdentityChoice) steps.push("identity");
  steps.push("media");
  if (input.needsTexts) steps.push("text");
  if (input.needsLocationStep) steps.push("location");
  if (input.needsPixelStep) steps.push("pixel");
  steps.push("review");
  return steps;
}

export function trailStepForPhase(phase: Phase): TrailStep {
  switch (phase) {
    case "planning":
    case "publishing":
      return "review";
    default:
      return phase;
  }
}

export const TRAIL_STEP_LABEL: Record<TrailStep, string> = {
  objective: "Objetivo",
  scanning: "Análise da conta",
  proven_ads: "Anúncios validados",
  budget: "Orçamento",
  identity: "Identidade",
  media: "Mídia",
  text: "Textos",
  location: "Localização",
  pixel: "Pixel",
  review: "Revisão",
};
