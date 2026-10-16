export type PromotionLinkObjective = "sales" | "whatsapp" | "followers" | "leads";

/**
 * Whether the AI wizard asks for a destination link, and how hard. Independent of the media: a
 * boosted Instagram post needs the link exactly as an uploaded image does — the post is the
 * creative, the link is where its button leads.
 *
 * - sales: the server refuses to publish without one (`FALLBACK_URL_REQUIRED`), so the wizard
 *   blocks first. The company website used to fill it in silently; the operator now sees it.
 * - leads: shown for parity with what the form always offered, but the leads endpoint never reads
 *   it (instant form), so nothing blocks on it.
 * - whatsapp / followers: the destination is the chat / the profile — no field at all.
 */
export function promotionLinkPolicy(
  objective: PromotionLinkObjective,
): "required" | "optional" | "hidden" {
  switch (objective) {
    case "sales":
      return "required";
    case "leads":
      return "optional";
    case "whatsapp":
    case "followers":
      return "hidden";
  }
}

/** A link Meta can actually open: an absolute http(s) URL. */
export function isValidPromotionLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
