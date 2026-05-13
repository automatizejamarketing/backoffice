/**
 * Canonical mapping between our internal placement keys and Meta Marketing API
 * targeting fields (publisher_platforms / facebook_positions / instagram_positions).
 *
 * Mirrored byte-equivalent at automatize-frontend/lib/meta-business/marketing/placements.ts
 * and enforced by tests/meta-placements-parity.test.ts.
 *
 * Scope is intentionally limited to the 6 placements the product surfaces today
 * (FB and IG: Feed, Stories, Reels). Adding Marketplace, Search, Audience Network,
 * Messenger or Advantage+ is out of scope and would require expanding both this
 * module and the validation rules per objective.
 */

export type PlacementKey =
  | "facebook_feed"
  | "facebook_stories"
  | "facebook_reels"
  | "instagram_feed"
  | "instagram_stories"
  | "instagram_reels";

type MetaPlacement = {
  /** Meta publisher_platforms value */
  platform: "facebook" | "instagram";
  /** Meta facebook_positions or instagram_positions value */
  position: string;
};

/**
 * The single source of truth for translating our keys to Meta's API fields.
 * Note: Meta uses "stream" for IG feed and "story" (singular) for both FB/IG stories.
 * Facebook Reels uses "facebook_reels"; Instagram Reels uses "reels".
 */
export const PLACEMENT_TO_META: Record<PlacementKey, MetaPlacement> = {
  facebook_feed: { platform: "facebook", position: "feed" },
  facebook_stories: { platform: "facebook", position: "story" },
  facebook_reels: { platform: "facebook", position: "facebook_reels" },
  instagram_feed: { platform: "instagram", position: "stream" },
  instagram_stories: { platform: "instagram", position: "story" },
  instagram_reels: { platform: "instagram", position: "reels" },
};

export const ALL_PLACEMENTS: readonly PlacementKey[] = [
  "facebook_feed",
  "facebook_stories",
  "facebook_reels",
  "instagram_feed",
  "instagram_stories",
  "instagram_reels",
];

export const INSTAGRAM_PLACEMENTS: readonly PlacementKey[] = [
  "instagram_feed",
  "instagram_stories",
  "instagram_reels",
];

export const FACEBOOK_PLACEMENTS: readonly PlacementKey[] = [
  "facebook_feed",
  "facebook_stories",
  "facebook_reels",
];

/**
 * Default placement set keyed by the campaign creation function (NOT by
 * WizardObjective — the wizard's "followers" maps to the "traffic" creator).
 * Maintains current behavior when callers don't pass an explicit placements array.
 */
export const DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE = {
  traffic: INSTAGRAM_PLACEMENTS,
  leads: ALL_PLACEMENTS,
  sales: ALL_PLACEMENTS,
} as const;

export type CampaignType = keyof typeof DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE;

export function isValidPlacementKey(value: unknown): value is PlacementKey {
  return (
    typeof value === "string" &&
    (ALL_PLACEMENTS as readonly string[]).includes(value)
  );
}

export function isInstagramOnly(
  placements: readonly PlacementKey[],
): boolean {
  if (placements.length === 0) return false;
  return placements.every((p) => PLACEMENT_TO_META[p].platform === "instagram");
}

export type PlacementTargetingFields = {
  publisher_platforms: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
};

/**
 * Builds the Meta targeting subset for the given placements. Returns ONLY the
 * three placement fields — callers must merge with the rest of the targeting
 * object (geo_locations, targeting_automation, etc.).
 *
 * Throws if `placements` is empty, since Meta rejects an ad set without at
 * least one publisher platform.
 *
 * Guarantees:
 * - `publisher_platforms` lists only platforms with at least one selected position.
 * - `facebook_positions` / `instagram_positions` are omitted when the
 *   corresponding array would be empty (Meta defaults to all positions for the
 *   listed platform when the positions array is absent — but here we always
 *   set the positions array when the platform appears, since the user has
 *   explicitly chosen a subset).
 */
export function placementsToTargetingFields(
  placements: readonly PlacementKey[],
): PlacementTargetingFields {
  if (placements.length === 0) {
    throw new Error(
      "placementsToTargetingFields: at least one placement is required",
    );
  }

  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];

  for (const key of placements) {
    if (!isValidPlacementKey(key)) {
      throw new Error(
        `placementsToTargetingFields: invalid placement key "${String(key)}"`,
      );
    }
    const meta = PLACEMENT_TO_META[key];
    if (meta.platform === "facebook") {
      facebookPositions.push(meta.position);
    } else {
      instagramPositions.push(meta.position);
    }
  }

  const publisherPlatforms: string[] = [];
  if (facebookPositions.length > 0) publisherPlatforms.push("facebook");
  if (instagramPositions.length > 0) publisherPlatforms.push("instagram");

  const result: PlacementTargetingFields = {
    publisher_platforms: publisherPlatforms,
  };
  if (facebookPositions.length > 0) {
    result.facebook_positions = facebookPositions;
  }
  if (instagramPositions.length > 0) {
    result.instagram_positions = instagramPositions;
  }
  return result;
}

/**
 * Reverse of placementsToTargetingFields. Inspects a targeting object returned
 * by the Meta Graph API and produces the corresponding PlacementKey set.
 *
 * Returns an empty array when the targeting object does not constrain
 * placements (e.g. Advantage+ Placements / Automatic Placements, where Meta
 * omits these fields entirely).
 *
 * Unknown positions outside the 6 keys we model are silently ignored — callers
 * that need to flag unsupported placements should compare the input arrays
 * against the result length.
 */
export function targetingFieldsToPlacements(
  targeting:
    | {
        publisher_platforms?: readonly string[];
        facebook_positions?: readonly string[];
        instagram_positions?: readonly string[];
      }
    | null
    | undefined,
): PlacementKey[] {
  if (!targeting) return [];
  const platforms = targeting.publisher_platforms ?? [];
  const fbPositions = targeting.facebook_positions ?? [];
  const igPositions = targeting.instagram_positions ?? [];

  if (platforms.length === 0 && fbPositions.length === 0 && igPositions.length === 0) {
    return [];
  }

  const result: PlacementKey[] = [];
  const seen = new Set<PlacementKey>();

  for (const key of ALL_PLACEMENTS) {
    const meta = PLACEMENT_TO_META[key];
    const positions = meta.platform === "facebook" ? fbPositions : igPositions;
    if (positions.includes(meta.position) && !seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }

  return result;
}

export type PlacementsValidationResult =
  | { ok: true; placements: PlacementKey[] | undefined }
  | { ok: false; reason: string };

/**
 * Validates an optional `placements` field arriving from an API request body.
 *
 * - `undefined` and `null` → ok, placements undefined (route uses default).
 * - Non-array, empty array, or array with invalid entries → not ok.
 * - For `campaignType === "traffic"`, any non-Instagram placement → not ok.
 *
 * Returns a structured result so callers can keep their existing error response
 * shape without throwing.
 */
export function validatePlacementsField(
  value: unknown,
  campaignType: CampaignType,
): PlacementsValidationResult {
  if (value === undefined || value === null) {
    return { ok: true, placements: undefined };
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: "placements must be an array when provided" };
  }
  if (value.length === 0) {
    return {
      ok: false,
      reason: "placements must contain at least one entry when provided",
    };
  }
  const parsed: PlacementKey[] = [];
  for (const entry of value) {
    if (!isValidPlacementKey(entry)) {
      return {
        ok: false,
        reason: `placements contains invalid entry "${String(entry)}"`,
      };
    }
    parsed.push(entry);
  }
  if (campaignType === "traffic") {
    const allowed = new Set<PlacementKey>(INSTAGRAM_PLACEMENTS);
    for (const p of parsed) {
      if (!allowed.has(p)) {
        return {
          ok: false,
          reason: `placements: "${p}" is not allowed for Instagram-only traffic campaigns`,
        };
      }
    }
  }
  return { ok: true, placements: parsed };
}
