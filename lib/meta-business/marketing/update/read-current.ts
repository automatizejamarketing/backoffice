/**
 * read-current — fetch the CURRENT state of a Meta object so an update primitive
 * can (a) validate conditional rules against the effective state and (b)
 * preserve untouched nested fields (ADR 0010).
 *
 * Each reader does ONE `GET /{id}` with exactly the fields the matching update
 * primitive needs, and each update primitive accepts a pre-fetched snapshot to
 * skip this read (e.g. when the caller already loaded the object). Keep the
 * field lists in sync with what the validators consume.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import type {
  AdSetScheduleBlock,
  AdSetTargeting,
} from "@/lib/meta-business/types";

const CAMPAIGN_FIELDS = [
  "id",
  "account_id",
  "name",
  "status",
  "effective_status",
  "objective",
  "daily_budget",
  "lifetime_budget",
  "spend_cap",
  "bid_strategy",
  "start_time",
  "stop_time",
  "special_ad_categories",
  "is_adset_budget_sharing_enabled",
].join(",");

const ADSET_FIELDS = [
  "id",
  "account_id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "daily_budget",
  "lifetime_budget",
  "start_time",
  "end_time",
  "optimization_goal",
  "billing_event",
  "bid_amount",
  "bid_strategy",
  "destination_type",
  "promoted_object",
  "targeting",
  "pacing_type",
  "adset_schedule",
  "campaign{id,objective,daily_budget,lifetime_budget,status}",
].join(",");

const AD_FIELDS = [
  "id",
  "account_id",
  "name",
  "status",
  "effective_status",
  "adset_id",
  "campaign_id",
  "creative{id}",
  "adset{id,optimization_goal,destination_type,status}",
  "campaign{id,objective,status}",
].join(",");

export type CampaignSnapshot = {
  id: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  spend_cap?: string;
  bid_strategy?: string;
  start_time?: string;
  stop_time?: string;
  special_ad_categories?: string[];
  is_adset_budget_sharing_enabled?: boolean | string;
};

export type AdSetSnapshot = {
  id: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: string;
  bid_strategy?: string;
  destination_type?: string;
  promoted_object?: Record<string, unknown>;
  targeting?: AdSetTargeting;
  pacing_type?: string[] | string;
  adset_schedule?: AdSetScheduleBlock[];
  campaign?: {
    id?: string;
    objective?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    status?: string;
  };
};

export type AdSnapshot = {
  id: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  adset_id?: string;
  campaign_id?: string;
  creative?: { id?: string };
  adset?: {
    id?: string;
    optimization_goal?: string;
    destination_type?: string;
    status?: string;
  };
  campaign?: { id?: string; objective?: string; status?: string };
};

export async function readCampaign(
  id: string,
  accessToken: string,
  snapshot?: CampaignSnapshot,
): Promise<CampaignSnapshot> {
  if (snapshot) return snapshot;
  return metaApiCall<CampaignSnapshot>({
    domain: "FACEBOOK",
    method: "GET",
    path: id,
    params: `fields=${CAMPAIGN_FIELDS}`,
    accessToken,
  });
}

export async function readAdSet(
  id: string,
  accessToken: string,
  snapshot?: AdSetSnapshot,
): Promise<AdSetSnapshot> {
  if (snapshot) return snapshot;
  return metaApiCall<AdSetSnapshot>({
    domain: "FACEBOOK",
    method: "GET",
    path: id,
    params: `fields=${ADSET_FIELDS}`,
    accessToken,
  });
}

export async function readAd(
  id: string,
  accessToken: string,
  snapshot?: AdSnapshot,
): Promise<AdSnapshot> {
  if (snapshot) return snapshot;
  return metaApiCall<AdSnapshot>({
    domain: "FACEBOOK",
    method: "GET",
    path: id,
    params: `fields=${AD_FIELDS}`,
    accessToken,
  });
}

/** Whether a campaign snapshot carries its own budget (CBO). */
export function campaignUsesBudget(c: Pick<CampaignSnapshot, "daily_budget" | "lifetime_budget">): boolean {
  return hasPositiveMinor(c.daily_budget) || hasPositiveMinor(c.lifetime_budget);
}

/** Whether the ad set's PARENT campaign carries the budget (CBO). */
export function parentUsesBudget(a: AdSetSnapshot): boolean {
  return (
    hasPositiveMinor(a.campaign?.daily_budget) ||
    hasPositiveMinor(a.campaign?.lifetime_budget)
  );
}

/** Minor-unit (cents) string that represents a value > 0. */
export function hasPositiveMinor(value: string | null | undefined): value is string {
  if (!value) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
