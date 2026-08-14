/**
 * getEntityDetails — full config + readable targeting/creative for ONE object
 * (design §4.4). Budgets and bid amounts are MINOR units → converted here.
 *
 * The targeting parser turns Meta's raw `targeting` object into the segmentation
 * the user configured: location (with radius), age, gender, interests by NAME,
 * custom/lookalike audiences, placements, languages, and the Advantage+ flag
 * (design §3, §7). This is "configured targeting", distinct from "performance by
 * breakdown" — the agent must not confuse the two (system-prompt rule 9).
 */
import { callMeta, type MetaCtx } from "./client";
import { minorToMajor } from "./currency";
import { assertObjectInAccount } from "./envelope";

export type EntityLevel = "campaign" | "adset" | "ad";

export type ParsedTargeting = {
  locations: {
    countries: string[];
    regions: string[];
    cities: Array<{ name: string; radius?: number; unit?: string }>;
  };
  ageMin: number | null;
  ageMax: number | null;
  /** "Todos" | "Homens" | "Mulheres". */
  genders: string;
  /** Interest names (resolved from targeting; no extra lookup needed). */
  interests: string[];
  customAudiences: string[];
  excludedCustomAudiences: string[];
  placements: {
    automatic: boolean;
    publisherPlatforms: string[];
    positions: Record<string, string[]>;
  };
  /** Locale ids (names require a separate lookup; counts usually suffice). */
  languageIds: number[];
  /** Advantage+ audience expansion on (true) / off (false) / unknown (null). */
  advantageAudience: boolean | null;
};

/**
 * Whether the object is actually able to deliver RIGHT NOW, derived from its
 * configured state alone — NOT a claim that it IS spending (BUG-003). Distinct
 * from `status`/`effective_status`: an ACTIVE object still won't deliver if it's
 * scheduled for later, past its end, or out of budget. "eligible" means nothing
 * structural blocks delivery — confirm real volume with getInsights.
 */
export type DeliveryState =
  | "eligible"
  | "scheduled"
  | "ended"
  | "budget_exhausted"
  | "not_active";

export type EntityDetails = {
  level: EntityLevel;
  id: string;
  name: string;
  status: string;
  /**
   * Derived delivery capability (see {@link DeliveryState}). The agent must not
   * say an object is "rodando normalmente" when this is not "eligible" or when
   * recent insights are zero.
   */
  deliveryState: DeliveryState;
  currency: string;
  config: Record<string, unknown>;
  targeting?: ParsedTargeting;
  creative?: {
    title: string | null;
    body: string | null;
    thumbnailUrl: string | null;
    type: string | null;
    callToAction: string | null;
  };
};

type RawGeo = {
  countries?: string[];
  regions?: Array<{ key?: string; name?: string }>;
  cities?: Array<{ key?: string; name?: string; radius?: number; distance_unit?: string }>;
};
type RawTargeting = {
  geo_locations?: RawGeo;
  age_min?: number;
  age_max?: number;
  genders?: number[];
  interests?: Array<{ id?: string; name?: string }>;
  flexible_spec?: Array<{ interests?: Array<{ id?: string; name?: string }> }>;
  custom_audiences?: Array<{ id?: string; name?: string }>;
  excluded_custom_audiences?: Array<{ id?: string; name?: string }>;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
  locales?: number[];
  targeting_automation?: { advantage_audience?: number };
};

function parseGenders(genders?: number[]): string {
  if (!genders || genders.length === 0 || genders.length === 2) return "Todos";
  if (genders[0] === 1) return "Homens";
  if (genders[0] === 2) return "Mulheres";
  return "Todos";
}

function parseTargeting(t: RawTargeting): ParsedTargeting {
  const geo = t.geo_locations ?? {};
  const interests = new Set<string>();
  for (const i of t.interests ?? []) if (i.name) interests.add(i.name);
  for (const spec of t.flexible_spec ?? [])
    for (const i of spec.interests ?? []) if (i.name) interests.add(i.name);

  const positions: Record<string, string[]> = {};
  if (t.facebook_positions?.length) positions.facebook = t.facebook_positions;
  if (t.instagram_positions?.length) positions.instagram = t.instagram_positions;
  if (t.messenger_positions?.length) positions.messenger = t.messenger_positions;
  if (t.audience_network_positions?.length)
    positions.audience_network = t.audience_network_positions;

  return {
    locations: {
      countries: geo.countries ?? [],
      regions: (geo.regions ?? []).map((r) => r.name ?? r.key ?? "").filter(Boolean),
      cities: (geo.cities ?? []).map((c) => ({
        name: c.name ?? c.key ?? "",
        ...(c.radius != null ? { radius: c.radius } : {}),
        ...(c.distance_unit ? { unit: c.distance_unit } : {}),
      })),
    },
    ageMin: t.age_min ?? null,
    ageMax: t.age_max ?? null,
    genders: parseGenders(t.genders),
    interests: Array.from(interests),
    customAudiences: (t.custom_audiences ?? []).map((a) => a.name ?? a.id ?? "").filter(Boolean),
    excludedCustomAudiences: (t.excluded_custom_audiences ?? [])
      .map((a) => a.name ?? a.id ?? "")
      .filter(Boolean),
    placements: {
      automatic: !t.publisher_platforms?.length,
      publisherPlatforms: t.publisher_platforms ?? [],
      positions,
    },
    languageIds: t.locales ?? [],
    advantageAudience:
      t.targeting_automation?.advantage_audience == null
        ? null
        : t.targeting_automation.advantage_audience === 1,
  };
}

const FIELDS: Record<EntityLevel, string> = {
  campaign:
    "id,account_id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,spend_cap,bid_strategy,special_ad_categories,start_time,stop_time",
  adset:
    "id,account_id,name,status,effective_status,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,destination_type,attribution_spec,promoted_object,targeting",
  ad: "id,account_id,name,status,effective_status,adset_id,campaign_id,creative{id,name,title,body,object_type,thumbnail_url,image_url,video_id,call_to_action_type,object_story_spec}",
};

const MONEY_FIELDS = [
  "daily_budget",
  "lifetime_budget",
  "budget_remaining",
  "spend_cap",
  "bid_amount",
];

type RawCreative = {
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  object_type?: string;
  call_to_action_type?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; call_to_action?: { type?: string } };
    video_data?: { message?: string; title?: string; call_to_action?: { type?: string } };
  };
};

/**
 * Derive {@link DeliveryState} from the raw object — zero extra Meta calls
 * (BUG-003). Uses only fields already requested: effective_status, the schedule
 * window, and (when the object owns a budget) budget_remaining. Schedule times
 * are absolute instants (carry an offset), so comparing against `Date.now()` is
 * timezone-safe.
 */
function computeDeliveryState(raw: Record<string, unknown>): DeliveryState {
  const eff = String(raw.effective_status ?? raw.status ?? "");
  if (eff !== "ACTIVE") return "not_active";

  const now = Date.now();
  const startRaw = raw.start_time;
  const stopRaw = raw.stop_time ?? raw.end_time;
  const start = typeof startRaw === "string" ? Date.parse(startRaw) : NaN;
  const stop = typeof stopRaw === "string" ? Date.parse(stopRaw) : NaN;
  if (!Number.isNaN(start) && start > now) return "scheduled";
  if (!Number.isNaN(stop) && stop < now) return "ended";

  // Only trust budget_remaining when the object carries its OWN budget — a CBO
  // ad set reports 0 here because the budget lives on the parent campaign. Raw
  // money fields are still in minor units (the major-unit copy goes to `config`).
  const ownBudget =
    Number(raw.daily_budget ?? 0) > 0 || Number(raw.lifetime_budget ?? 0) > 0;
  const remaining =
    raw.budget_remaining != null ? Number(raw.budget_remaining) : NaN;
  if (ownBudget && !Number.isNaN(remaining) && remaining <= 0) {
    return "budget_exhausted";
  }

  return "eligible";
}

export async function getEntityDetails(
  ctx: MetaCtx,
  args: { level: EntityLevel; id: string },
): Promise<EntityDetails> {
  const raw = await callMeta<Record<string, unknown> & { targeting?: RawTargeting; creative?: RawCreative }>(
    {
      domain: "FACEBOOK",
      method: "GET",
      path: args.id,
      params: `fields=${FIELDS[args.level]}`,
      accessToken: ctx.accessToken,
    },
  );

  // Read-side ownership guard (ADR 0013): refuse to surface an object that lives
  // in a DIFFERENT account than the conversation's — piggybacks `account_id` on
  // the read above (no extra call). Reported as NOT_FOUND to the agent.
  assertObjectInAccount(
    args.id,
    raw.account_id as string | undefined,
    ctx.adAccountId,
  );

  // Convert minor-unit money fields to major units (in place, into config).
  // `account_id` is used only for the ownership check — keep it out of config.
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "targeting" || key === "creative" || key === "account_id") {
      continue;
    }
    config[key] = MONEY_FIELDS.includes(key)
      ? minorToMajor(value as string)
      : value;
  }

  const details: EntityDetails = {
    level: args.level,
    id: String(raw.id ?? args.id),
    name: String(raw.name ?? "(sem nome)"),
    status: String(raw.effective_status ?? raw.status ?? "UNKNOWN"),
    deliveryState: computeDeliveryState(raw),
    currency: ctx.currency,
    config,
  };

  if (args.level === "adset" && raw.targeting) {
    details.targeting = parseTargeting(raw.targeting);
  }

  if (args.level === "ad" && raw.creative) {
    const c = raw.creative;
    const story = c.object_story_spec;
    details.creative = {
      title: c.title ?? story?.video_data?.title ?? story?.link_data?.name ?? null,
      body: c.body ?? story?.link_data?.message ?? story?.video_data?.message ?? null,
      thumbnailUrl: c.thumbnail_url ?? c.image_url ?? null,
      type: c.object_type ?? null,
      callToAction:
        c.call_to_action_type ??
        story?.link_data?.call_to_action?.type ??
        story?.video_data?.call_to_action?.type ??
        null,
    };
  }

  return details;
}
