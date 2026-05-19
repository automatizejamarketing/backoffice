import { CampaignObjective } from "./types";

/**
 * High-level objective buckets surfaced in the campaigns filter. Each bucket
 * maps to one ODAX outcome plus its legacy (pre-ODAX) objective equivalents,
 * so a single filter selection covers campaigns created in either era.
 */
export type CampaignObjectiveGroup =
  | "awareness"
  | "traffic"
  | "engagement"
  | "leads"
  | "app"
  | "sales";

export type CampaignObjectiveFilter = CampaignObjectiveGroup | "all";

export const OBJECTIVE_GROUP_ORDER: CampaignObjectiveFilter[] = [
  "all",
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "app",
  "sales",
];

export const OBJECTIVE_GROUP_LABELS: Record<CampaignObjectiveFilter, string> = {
  all: "Todos",
  awareness: "Reconhecimento",
  traffic: "Tráfego",
  engagement: "Engajamento",
  leads: "Leads",
  app: "Promoção do app",
  sales: "Vendas",
};

export const OBJECTIVE_GROUP_TO_OBJECTIVES: Record<
  CampaignObjectiveGroup,
  CampaignObjective[]
> = {
  awareness: [
    CampaignObjective.OUTCOME_AWARENESS,
    CampaignObjective.BRAND_AWARENESS,
    CampaignObjective.REACH,
    CampaignObjective.LOCAL_AWARENESS,
    CampaignObjective.STORE_VISITS,
  ],
  traffic: [
    CampaignObjective.OUTCOME_TRAFFIC,
    CampaignObjective.LINK_CLICKS,
  ],
  engagement: [
    CampaignObjective.OUTCOME_ENGAGEMENT,
    CampaignObjective.POST_ENGAGEMENT,
    CampaignObjective.PAGE_LIKES,
    CampaignObjective.EVENT_RESPONSES,
    CampaignObjective.VIDEO_VIEWS,
    CampaignObjective.MESSAGES,
    CampaignObjective.OFFER_CLAIMS,
  ],
  leads: [
    CampaignObjective.OUTCOME_LEADS,
    CampaignObjective.LEAD_GENERATION,
  ],
  app: [
    CampaignObjective.OUTCOME_APP_PROMOTION,
    CampaignObjective.APP_INSTALLS,
  ],
  sales: [
    CampaignObjective.OUTCOME_SALES,
    CampaignObjective.CONVERSIONS,
    CampaignObjective.PRODUCT_CATALOG_SALES,
  ],
};

export function isCampaignObjectiveFilter(
  value: string | null | undefined,
): value is CampaignObjectiveFilter {
  return (
    value != null &&
    Object.prototype.hasOwnProperty.call(OBJECTIVE_GROUP_LABELS, value)
  );
}

/**
 * Raw Meta objective enum values for a filter selection, or `null` for "all"
 * (no objective filtering). Used to build the Graph API `filtering` clause.
 */
export function getObjectivesForGroup(
  filter: CampaignObjectiveFilter,
): CampaignObjective[] | null {
  if (filter === "all") return null;
  return OBJECTIVE_GROUP_TO_OBJECTIVES[filter];
}

/** The bucket a campaign objective belongs to, for client-side labelling. */
export function getObjectiveGroup(
  objective: CampaignObjective | undefined,
): CampaignObjectiveGroup | undefined {
  if (!objective) return undefined;
  for (const group of Object.keys(
    OBJECTIVE_GROUP_TO_OBJECTIVES,
  ) as CampaignObjectiveGroup[]) {
    if (OBJECTIVE_GROUP_TO_OBJECTIVES[group].includes(objective)) {
      return group;
    }
  }
  return undefined;
}
