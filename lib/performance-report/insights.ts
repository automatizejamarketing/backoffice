import { graphApiVersion, graphFacebookBaseUrl } from "@/lib/meta-business/constant";
import { appSecretProof, facebookAppSecret } from "@/lib/meta-business/appsecret-proof";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import {
  HUD_AD_EFFECTIVE_STATUSES,
  HUD_CAMPAIGN_EFFECTIVE_STATUSES,
  sortCampaignsNewestFirst,
} from "./analysis";
import type { ReportClient } from "./client";
import type { PerformanceDatePreset } from "./filters";
import { metricsFromInsight, type InsightMetrics, type RawInsight } from "./metrics";

const MAX_ACCOUNTS = 5;
const MAX_CAMPAIGNS = 500;
const MAX_ADS = 500;
const GRAPH_PAGE_SIZE = 100;

const INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "website_purchase_roas",
  "date_start",
  "date_stop",
].join(",");

export type StoredAdAccount = {
  id: string;
  accountId?: string;
  name?: string;
};

export function formatActId(accountId: string): string {
  const trimmed = accountId.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const search = new URLSearchParams({
    ...params,
    access_token: accessToken,
  });
  const secret = facebookAppSecret();
  if (secret) {
    search.set("appsecret_proof", appSecretProof(accessToken, secret));
  }
  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${path}?${search.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const json = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok || json.error) {
    throw new Error(
      `Meta Graph ${response.status}: ${json.error?.message ?? response.statusText}`,
    );
  }
  return json;
}

type GraphPage<T> = {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
};

type CompleteRows<T> = {
  rows: T[];
  truncated: boolean;
};

async function graphGetAll<T>(input: {
  path: string;
  accessToken: string;
  params: Record<string, string>;
  maxItems: number;
  collected?: T[];
  after?: string;
}): Promise<CompleteRows<T>> {
  const existing = input.collected ?? [];
  const remaining = Math.max(input.maxItems - existing.length, 1);
  const page = await graphGet<GraphPage<T>>(input.path, input.accessToken, {
    ...input.params,
    limit: String(Math.min(GRAPH_PAGE_SIZE, remaining)),
    ...(input.after ? { after: input.after } : {}),
  });
  const collected = [...existing, ...(page.data ?? [])];
  const after = page.paging?.cursors?.after;
  const hasNext = Boolean(page.paging?.next && after);

  if (!hasNext) {
    return { rows: collected, truncated: false };
  }
  if (collected.length >= input.maxItems) {
    return {
      rows: collected.slice(0, input.maxItems),
      truncated: true,
    };
  }
  return graphGetAll({
    ...input,
    collected,
    after,
  });
}

export type CampaignInsightRow = InsightMetrics & {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
};

export type AdInsightRow = InsightMetrics & {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  campaignId: string | null;
  campaignName: string | null;
  creativeId: string | null;
  creativeName: string | null;
  creativeTitle: string | null;
};

export type AccountInsightBundle = {
  accountId: string;
  name: string | null;
  currency: string | null;
  accountMetrics?: InsightMetrics;
  campaigns?: CampaignInsightRow[];
  ads?: AdInsightRow[];
  truncated?: { campaigns?: boolean; ads?: boolean };
  error?: string;
};

type GraphCampaign = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  insights?: { data?: RawInsight[] };
};

type GraphAd = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  campaign?: { id?: string; name?: string };
  creative?: { id?: string; name?: string; title?: string };
  insights?: { data?: RawInsight[] };
};

async function fetchAccountInsight(input: {
  accessToken: string;
  accountId: string;
  datePreset: PerformanceDatePreset;
  since?: string;
  until?: string;
}): Promise<InsightMetrics> {
  const params: Record<string, string> = {
    fields: INSIGHT_FIELDS,
    level: "account",
  };
  if (input.since && input.until) {
    params.time_range = JSON.stringify({
      since: input.since,
      until: input.until,
    });
  } else {
    params.date_preset = input.datePreset;
  }

  const data = await graphGet<{ data?: RawInsight[] }>(
    `${formatActId(input.accountId)}/insights`,
    input.accessToken,
    params,
  );
  return metricsFromInsight(data.data?.[0]);
}

async function fetchCampaignInsights(input: {
  accessToken: string;
  accountId: string;
  datePreset: PerformanceDatePreset;
  since?: string;
  until?: string;
  campaignId?: string;
  limit: number;
}): Promise<CompleteRows<CampaignInsightRow>> {
  const insightNested =
    input.since && input.until
      ? `insights.time_range({'since':'${input.since}','until':'${input.until}'}){${INSIGHT_FIELDS}}`
      : `insights.date_preset(${input.datePreset}){${INSIGHT_FIELDS}}`;
  const campaignFields = `id,name,status,effective_status,objective,start_time,stop_time,created_time,${insightNested}`;

  if (input.campaignId?.trim()) {
    const data = await graphGet<GraphCampaign>(
      input.campaignId.trim(),
      input.accessToken,
      { fields: campaignFields },
    );
    return { rows: [mapCampaignInsight(data)], truncated: false };
  }

  const result = await graphGetAll<GraphCampaign>({
    path: `${formatActId(input.accountId)}/campaigns`,
    accessToken: input.accessToken,
    maxItems: input.limit,
    params: {
      fields: campaignFields,
      effective_status: JSON.stringify([...HUD_CAMPAIGN_EFFECTIVE_STATUSES]),
    },
  });

  return {
    rows: sortCampaignsNewestFirst(result.rows.map(mapCampaignInsight)),
    truncated: result.truncated,
  };
}

function mapCampaignInsight(campaign: GraphCampaign): CampaignInsightRow {
  return {
    id: campaign.id,
    name: campaign.name ?? campaign.id,
    status: campaign.status ?? null,
    effectiveStatus: campaign.effective_status ?? null,
    objective: campaign.objective ?? null,
    startTime: campaign.start_time ?? null,
    stopTime: campaign.stop_time ?? null,
    createdTime: campaign.created_time ?? null,
    ...metricsFromInsight(campaign.insights?.data?.[0]),
  };
}

async function fetchAdAccountCurrency(
  accessToken: string,
  accountId: string,
): Promise<string | null> {
  const data = await graphGet<{ currency?: string }>(
    formatActId(accountId),
    accessToken,
    { fields: "currency" },
  );
  return data.currency ?? null;
}

async function fetchAdInsights(input: {
  accessToken: string;
  accountId: string;
  datePreset: PerformanceDatePreset;
  since?: string;
  until?: string;
  campaignId?: string;
  limit: number;
}): Promise<CompleteRows<AdInsightRow>> {
  const insightNested =
    input.since && input.until
      ? `insights.time_range({'since':'${input.since}','until':'${input.until}'}){${INSIGHT_FIELDS}}`
      : `insights.date_preset(${input.datePreset}){${INSIGHT_FIELDS}}`;

  const params: Record<string, string> = {
    fields: `id,name,status,effective_status,campaign_id,campaign{id,name},creative{id,name,title},${insightNested}`,
    effective_status: JSON.stringify([...HUD_AD_EFFECTIVE_STATUSES]),
  };
  if (input.campaignId?.trim()) {
    params.filtering = JSON.stringify([
      {
        field: "campaign.id",
        operator: "EQUAL",
        value: input.campaignId.trim(),
      },
    ]);
  }

  const result = await graphGetAll<GraphAd>({
    path: `${formatActId(input.accountId)}/ads`,
    accessToken: input.accessToken,
    params,
    maxItems: input.limit,
  });

  return {
    rows: result.rows.map((ad) => ({
      id: ad.id,
      name: ad.name ?? ad.id,
      status: ad.status ?? null,
      effectiveStatus: ad.effective_status ?? null,
      campaignId: ad.campaign_id ?? ad.campaign?.id ?? null,
      campaignName: ad.campaign?.name ?? null,
      creativeId: ad.creative?.id ?? null,
      creativeName: ad.creative?.name ?? null,
      creativeTitle: ad.creative?.title ?? null,
      ...metricsFromInsight(ad.insights?.data?.[0]),
    })),
    truncated: result.truncated,
  };
}

async function resolveAccounts(input: {
  client: ReportClient;
  accountId?: string;
}): Promise<{ accessToken: string; accounts: StoredAdAccount[] }> {
  const tokenResult = await getUserAccessTokenByUserId(input.client.userId);
  if (!tokenResult.success) {
    throw new Error(tokenResult.error.message);
  }

  let accounts: StoredAdAccount[] = input.client.assignedAdAccounts;
  if (accounts.length === 0) {
    const graphUser = await getUserWithAdAccounts(tokenResult.accessToken, {
      tokenKind: tokenResult.connection.tokenKind,
      bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
      clientBusinessId: tokenResult.connection.clientBusinessId,
      connectionName: tokenResult.connection.name,
    });
    accounts = (graphUser.adaccounts?.data ?? []).map((account) => ({
      id: account.id,
      accountId: account.account_id,
      name: account.name,
    }));
  }

  if (input.accountId) {
    const wanted = formatActId(input.accountId);
    accounts = accounts.filter(
      (account) =>
        formatActId(account.id) === wanted || account.accountId === input.accountId,
    );
    if (accounts.length === 0) {
      accounts = [{ id: wanted, name: wanted }];
    }
  }

  return {
    accessToken: tokenResult.accessToken,
    accounts: accounts.slice(0, MAX_ACCOUNTS),
  };
}

export async function loadClientInsightsBundle(input: {
  client: ReportClient;
  accountId?: string;
  campaignId?: string;
  datePreset: PerformanceDatePreset;
  since?: string;
  until?: string;
  includeCreatives?: boolean;
}): Promise<{
  datePreset: PerformanceDatePreset | "custom";
  since: string | null;
  until: string | null;
  accounts: AccountInsightBundle[];
}> {
  const { accessToken, accounts } = await resolveAccounts(input);
  const campaignLimit = MAX_CAMPAIGNS;
  const adLimit = MAX_ADS;

  const results = await Promise.all(
    accounts.map(async (account): Promise<AccountInsightBundle> => {
      try {
        const [currency, accountMetrics, campaignResult] = await Promise.all([
          fetchAdAccountCurrency(accessToken, account.id),
          fetchAccountInsight({
            accessToken,
            accountId: account.id,
            datePreset: input.datePreset,
            since: input.since,
            until: input.until,
          }),
          fetchCampaignInsights({
            accessToken,
            accountId: account.id,
            datePreset: input.datePreset,
            since: input.since,
            until: input.until,
            campaignId: input.campaignId,
            limit: campaignLimit,
          }),
        ]);
        let ads: AdInsightRow[] | undefined;
        let adsTruncated: boolean | undefined;
        if (input.includeCreatives) {
          const adResult = await fetchAdInsights({
            accessToken,
            accountId: account.id,
            datePreset: input.datePreset,
            since: input.since,
            until: input.until,
            campaignId: input.campaignId,
            limit: adLimit,
          });
          ads = adResult.rows;
          adsTruncated = adResult.truncated;
        }
        return {
          accountId: formatActId(account.id),
          name: account.name ?? null,
          currency,
          accountMetrics,
          campaigns: campaignResult.rows,
          ads,
          truncated: {
            campaigns: campaignResult.truncated,
            ads: adsTruncated,
          },
        };
      } catch (error) {
        return {
          accountId: formatActId(account.id),
          name: account.name ?? null,
          currency: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    datePreset: input.since && input.until ? "custom" : input.datePreset,
    since: input.since ?? null,
    until: input.until ?? null,
    accounts: results,
  };
}
