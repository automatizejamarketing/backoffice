/**
 * verifyMold + the review's shape (ADR 0022/0023).
 *
 * The browser hands back the ids the scan elected; `verifyMold` re-measures them FROM META, so the
 * review's claim ("baseado no seu anúncio validado, ROAS 8,3") is the product's own measurement and
 * not something the client asserted — it also bounds the ids to the account (an ad from somewhere
 * else returns no row). `ReviewSummary` is the business-language shape the review screen renders,
 * never a Meta payload. Both feed the duplication plan/create path — the plan itself lives in
 * `planDuplicatedCampaign` (duplicate-campaign.ts).
 */
import { getInsights, minorToMajor, type MetaCtx } from "@/lib/meta-business/insights";
import { validationWindow } from "./scan-account";
import { classifyAd } from "./validation-rules";
import type { MoldRef } from "./pick-mold";
import type { CampaignMold } from "./read-mold";

/** The ad the client pointed at is not in this account (or never delivered in the window). */
export class MoldNotFoundError extends Error {
  constructor(adId: string) {
    super(`O anúncio ${adId} não foi encontrado nesta conta de anúncio.`);
    this.name = "MoldNotFoundError";
  }
}

/** Everything the review screen shows, in business language. Never a Meta payload. */
export type ReviewSummary = {
  /**
   * What the campaign was based on — or NULL when the account proved nothing and the flow fell back
   * to the niche presets. Null means the review says NOTHING about history (ADR 0022, decision 6):
   * no "we found nothing" message, ever.
   */
  basedOn: {
    kind: MoldRef["kind"];
    adName: string | null;
    /** What the base ad spent proving itself — the weight behind the claim. */
    spend: number;
    roas: number | null;
    costPerResult: number | null;
    resultLabel: string;
    currency: string;
  } | null;
  /** The account's currency — needed to render money even when there is no base ad. */
  currency: string;
  /** The ODAX objective, raw. The UI owns its label — this layer does not speak the user's language. */
  objective: string;
  campaignName: string;
  /** N ad sets × 1 ad — the 1-N-1 shape, spelled out. */
  structure: { adSets: number; adsPerAdSet: number };
  budget: {
    mode: "CBO" | "ABO";
    /** What the user pays PER DAY for the whole campaign — always the number they answered. */
    dailyCents: number;
    /** Under ABO with more than one ad set: how that daily budget is split between them. */
    perAdSetDailyCents?: number;
    /** When the mold's budget is lifetime: the TOTAL committed, and the flight it buys. */
    lifetimeCents?: number;
    startTime?: string;
    stopTime?: string;
    /**
     * Whether delivery HOURS can be applied to this campaign at all.
     *
     * Meta only accepts `adset_schedule` (day-parting) on an ad set whose budget is a LIFETIME one,
     * and the duplication copies the proven campaign's budget shape as it found it. A proven campaign
     * running on a daily budget therefore cannot carry an hours grid — so the review hides the editor
     * instead of collecting hours Meta would reject at publish time.
     */
    daypartingAllowed?: boolean;
  };
  medias: Array<{
    kind: "instagram_post" | "image" | "video";
    /** Image URL, or the video's Meta-generated thumbnail. */
    preview?: string;
  }>;
  /** Proven ads the user chose to duplicate — shown on the review (ADR 0023). */
  provenAds?: Array<{
    adId: string;
    adName: string | null;
    thumbnailUrl: string | null;
    spend: number;
    roas: number | null;
    costPerResult: number | null;
    resultLabel: string;
  }>;
  texts?: { headline: string; message: string; ctaType: string; link: string };
  /**
   * The copied audience as NUMBERS, never as sentences. Building "2 endereços com raio" here would
   * ship Portuguese prose to an English screen (the app is pt-BR + en) — the component owns the
   * words, this layer owns the facts.
   */
  audience: {
    geo: {
      customLocations: number;
      cities: number;
      regions: number;
      countries: number;
      /**
       * The targeted places spelled out — address/name + optional radius in km. Facts, not prose:
       * the component turns a radius into "raio X km". Present when we can name the places (custom
       * addresses, cities); broad region/country targeting still relies on the counts above.
       */
      locations?: Array<{ label: string; radiusKm?: number }>;
    };
    advantagePlus: boolean;
    interestGroups: number;
    customAudiences: number;
    placements: {
      automatic: boolean;
      /**
       * Absent when `automatic` — Advantage+ placements pin nothing, so there is no
       * platform list to show (the review card short-circuits on `automatic` before
       * reading this).
       */
      platforms?: string[];
      /** Meta's per-platform position codes (feed, story, reels…) — discriminated when present. */
      facebookPositions?: string[];
      instagramPositions?: string[];
    };
    ageMin?: number;
    ageMax?: number;
    /** Meta's codes: 1 = male, 2 = female. Absent/empty = everyone. */
    genders?: number[];
  };
  schedule?: {
    mode: "continuous" | "dayparting";
    blocks: number;
    /** Concrete dayparts when available — seeds the AI review schedule editor. */
    dayParts?: Array<{
      days: number[];
      startMinute: number;
      endMinute: number;
    }>;
  };
  identity: { pageId?: string; instagramUserId?: string };
  pixelId?: string;
  /**
   * Present ONLY on a click-to-WhatsApp campaign — its presence is what tells the review screen
   * this ad leads to a conversation instead of a site. The objective alone cannot say so: a CTWA
   * campaign and a website one are both `OUTCOME_SALES`.
   *
   * No phone number here on purpose. The ad set promotes the Page and Meta resolves the number
   * from it, so the number is not part of the plan — the screen reads it separately, and is
   * allowed to fail to.
   */
  whatsapp?: {
    /** The message that arrives already typed in the customer's chat. */
    autofillMessage?: string;
  };
};

/**
 * Re-derive the mold's numbers and its verdict FROM META, ignoring whatever the browser posted.
 *
 * The client hands back the ids the scan elected, and ids are just pointers — but "baseado no seu
 * anúncio validado (ROAS 8,3)" is a claim the product makes, so the product has to be the one
 * measuring it. This also bounds the ids to the account: an ad from somewhere else returns no row.
 */
export async function verifyMold(
  ctx: MetaCtx,
  ref: MoldRef,
  mold: CampaignMold,
): Promise<MoldRef> {
  const { since, until } = validationWindow(ctx.timezoneName);
  const { rows } = await getInsights(ctx, {
    level: "ad",
    ids: [ref.adId],
    since,
    until,
    objective: mold.campaign.objective,
    limit: 1,
  });

  const row = rows[0];
  if (!row || row.spend == null) throw new MoldNotFoundError(ref.adId);

  // The floor depends on the ad's own daily budget: the campaign's under CBO, the ad set's under
  // ABO, and unknown (→ conservative floor) when only a lifetime budget exists.
  const dailyBudget =
    minorToMajor(mold.campaign.dailyBudgetCents) ??
    minorToMajor(mold.adSet.dailyBudgetCents);

  const kind = classifyAd({
    adId: ref.adId,
    adName: row.name ?? null,
    adSetId: ref.adSetId,
    campaignId: ref.campaignId,
    objective: mold.campaign.objective,
    spend: row.spend,
    dailyBudget,
    roas: row.result.roas,
    result: {
      label: row.result.label,
      count: row.result.count,
      costPerResult: row.result.costPerResult,
    },
  });

  return {
    // A pointer that no longer qualifies still gets planned — but the banner will not call it
    // "validado" when it isn't (the issue below tells the user why).
    kind: kind === "none" ? ref.kind : kind,
    adId: ref.adId,
    adName: row.name ?? ref.adName,
    adSetId: ref.adSetId,
    campaignId: ref.campaignId,
    objective: mold.campaign.objective,
    metrics: {
      spend: row.spend,
      roas: row.result.roas,
      resultLabel: row.result.label,
      resultCount: row.result.count,
      costPerResult: row.result.costPerResult,
      currency: ctx.currency,
    },
  };
}

/** What the ACCOUNT (not the user) constrains. Read once by the route, from Meta itself. */
export type AccountLimits = {
  /** Meta's minimum daily budget for one ad set in this account, in MINOR units. */
  minDailyBudgetCents?: number | null;
};
