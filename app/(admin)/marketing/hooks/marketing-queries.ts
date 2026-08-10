"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { convertTimeIncrementToDays } from "@/lib/meta-business/convert-time-increment-to-days";
import {
  AdSetStatus,
  AdStatus,
  CampaignStatus,
  EffectiveStatus,
  type Ad,
  type AdSet,
  type Campaign,
  type InsightsMetrics,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import type { AdSetConversionDetails } from "@/lib/meta-business/marketing/adset-conversion-details";

import {
  marketingKeys,
  type AdListFilters,
  type AdSetListFilters,
  type CampaignListFilters,
  type InsightsRange,
} from "./marketing-query-keys";
import { sortMarketingItems } from "../utils/sort-marketing-items";

const INSIGHTS_STALE_TIME = 5 * 60 * 1000;
const MAX_CAMPAIGNS = 500;
const FETCH_ALL_PAGE_LIMIT = 100;

async function fetchAllPaginated<T>(
  buildUrl: (after?: string) => string,
): Promise<T[]> {
  const collected: T[] = [];
  let after: string | undefined;

  do {
    const response = await fetch(buildUrl(after));
    if (!response.ok) {
      throw new Error("Falha ao buscar dados");
    }
    const payload = (await response.json()) as {
      data?: T[];
      pagination?: PaginationInfo | null;
    };
    collected.push(...(payload.data ?? []));
    after = payload.pagination?.hasNextPage
      ? payload.pagination.nextCursor ?? undefined
      : undefined;
  } while (after);

  return collected;
}

function basePath(accountId: string): string {
  return `/api/meta-marketing/${accountId}`;
}

function appendDateRange(
  params: URLSearchParams,
  range: { since?: string | null; until?: string | null; datePreset?: string | null },
) {
  if (range.since && range.until) {
    params.set("since", range.since);
    params.set("until", range.until);
  } else if (range.datePreset) {
    params.set("datePreset", range.datePreset);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type CampaignsResult = { data: Campaign[]; pagination: null };

export function useCampaigns(
  accountId: string,
  userId: string,
  filters: CampaignListFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<CampaignsResult>({
    queryKey: marketingKeys.campaignList(accountId, userId, filters),
    enabled: options?.enabled !== false && Boolean(accountId) && Boolean(userId),
    queryFn: async () => {
      // `fetchAll` makes the route follow Meta pagination internally and return
      // the full set so sorting/filtering covers every campaign.
      const baseParams = new URLSearchParams({ userId, fetchAll: "1" });
      appendDateRange(baseParams, filters);
      if (filters.objectiveFilter && filters.objectiveFilter !== "all") {
        baseParams.set("objective", filters.objectiveFilter);
      }

      let combined: Campaign[];

      // Default: status order — all ACTIVE first, then all PAUSED.
      const activeParams = new URLSearchParams(baseParams);
      activeParams.set("effectiveStatus", "ACTIVE");
      const pausedParams = new URLSearchParams(baseParams);
      pausedParams.set("effectiveStatus", "PAUSED");

      const [activeRes, pausedRes] = await Promise.all([
        fetch(`${basePath(accountId)}/campaigns?${activeParams}`),
        fetch(`${basePath(accountId)}/campaigns?${pausedParams}`),
      ]);
      if (!activeRes.ok || !pausedRes.ok) {
        throw new Error("Falha ao buscar campanhas");
      }
      const activeData = (await activeRes.json()) as { data?: Campaign[] };
      const pausedData = (await pausedRes.json()) as { data?: Campaign[] };
      combined = [...(activeData.data ?? []), ...(pausedData.data ?? [])];

      if (filters.sortMetric) {
        combined = sortMarketingItems(
          combined,
          filters.sortMetric,
          filters.sortOrder ?? "desc",
        );
      }

      return { data: combined.slice(0, MAX_CAMPAIGNS), pagination: null };
    },
  });
}

export function useCampaignDetail(
  accountId: string,
  userId: string,
  campaignId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<Campaign | null>({
    queryKey: marketingKeys.campaignDetail(accountId, userId, campaignId),
    enabled:
      options?.enabled !== false &&
      Boolean(accountId) &&
      Boolean(userId) &&
      Boolean(campaignId),
    queryFn: async () => {
      const response = await fetch(
        `${basePath(accountId)}/campaigns/${campaignId}?userId=${userId}`,
      );
      if (!response.ok) {
        throw new Error("Falha ao buscar campanha");
      }
      const data = (await response.json()) as { campaign?: Campaign };
      return data.campaign ?? null;
    },
  });
}

type AdSetsResult = { data: AdSet[]; pagination: PaginationInfo | null };

export function useAdSets(
  accountId: string,
  userId: string,
  filters: AdSetListFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<AdSetsResult>({
    queryKey: marketingKeys.adsetList(accountId, userId, filters),
    enabled: options?.enabled !== false && Boolean(accountId) && Boolean(userId),
    queryFn: async () => {
      const baseParams = new URLSearchParams({ userId });
      if (filters.campaignId) baseParams.set("campaignId", filters.campaignId);
      appendDateRange(baseParams, filters);

      const fetchAllForStatus = async (effectiveStatus: string) =>
        fetchAllPaginated<AdSet>((after) => {
          const params = new URLSearchParams(baseParams);
          params.set("effectiveStatus", effectiveStatus);
          params.set("limit", String(FETCH_ALL_PAGE_LIMIT));
          if (after) params.set("after", after);
          return `${basePath(accountId)}/adsets?${params}`;
        });

      const fetchPageForStatus = async (effectiveStatus: string) => {
        const params = new URLSearchParams(baseParams);
        params.set("effectiveStatus", effectiveStatus);
        params.set("limit", "25");
        if (filters.cursor) params.set("after", filters.cursor);
        const response = await fetch(`${basePath(accountId)}/adsets?${params}`);
        if (!response.ok) {
          throw new Error("Falha ao buscar conjuntos de anúncios");
        }
        return (await response.json()) as {
          data?: AdSet[];
          pagination?: PaginationInfo;
        };
      };

      if (filters.sortMetric) {
        const [activeItems, pausedItems] = await Promise.all([
          fetchAllForStatus("ACTIVE"),
          fetchAllForStatus("PAUSED,CAMPAIGN_PAUSED"),
        ]);
        return {
          data: sortMarketingItems(
            [...activeItems, ...pausedItems],
            filters.sortMetric,
            filters.sortOrder ?? "desc",
          ),
          pagination: null,
        };
      }

      const [activeData, pausedData] = await Promise.all([
        fetchPageForStatus("ACTIVE"),
        fetchPageForStatus("PAUSED,CAMPAIGN_PAUSED"),
      ]);

      return {
        data: [...(activeData.data ?? []), ...(pausedData.data ?? [])],
        pagination: {
          hasNextPage:
            (activeData.pagination?.hasNextPage ?? false) ||
            (pausedData.pagination?.hasNextPage ?? false),
          hasPreviousPage:
            (activeData.pagination?.hasPreviousPage ?? false) ||
            (pausedData.pagination?.hasPreviousPage ?? false),
          nextCursor:
            activeData.pagination?.nextCursor ??
            pausedData.pagination?.nextCursor,
          previousCursor:
            activeData.pagination?.previousCursor ??
            pausedData.pagination?.previousCursor,
        },
      };
    },
  });
}

type AdsResult = { data: Ad[]; pagination: PaginationInfo | null };

export function useAds(
  accountId: string,
  userId: string,
  filters: AdListFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<AdsResult>({
    queryKey: marketingKeys.adList(accountId, userId, filters),
    enabled: options?.enabled !== false && Boolean(accountId) && Boolean(userId),
    queryFn: async () => {
      const baseParams = new URLSearchParams({
        limit: String(FETCH_ALL_PAGE_LIMIT),
        userId,
      });
      if (filters.adSetId) baseParams.set("adsetId", filters.adSetId);
      appendDateRange(baseParams, filters);

      if (filters.sortMetric) {
        const allAds = await fetchAllPaginated<Ad>((after) => {
          const params = new URLSearchParams(baseParams);
          if (after) params.set("after", after);
          return `${basePath(accountId)}/ads?${params}`;
        });
        return {
          data: sortMarketingItems(
            allAds,
            filters.sortMetric,
            filters.sortOrder ?? "desc",
          ),
          pagination: null,
        };
      }

      const params = new URLSearchParams(baseParams);
      params.set("limit", "25");
      if (filters.cursor) params.set("after", filters.cursor);

      const response = await fetch(`${basePath(accountId)}/ads?${params}`);
      if (!response.ok) {
        throw new Error("Falha ao buscar anúncios");
      }
      const data = (await response.json()) as {
        data?: Ad[];
        pagination?: PaginationInfo;
      };
      return { data: data.data ?? [], pagination: data.pagination ?? null };
    },
  });
}

export type InsightsResult = {
  insightsArray: InsightsMetrics[];
  total: InsightsMetrics | undefined;
};

async function fetchInsights(
  accountId: string,
  userId: string,
  path: string,
  range: InsightsRange,
): Promise<InsightsResult> {
  const seriesParams = new URLSearchParams({ userId });
  if (range.timeIncrement) {
    seriesParams.set(
      "timeIncrement",
      convertTimeIncrementToDays(range.timeIncrement),
    );
  }
  appendDateRange(seriesParams, range);

  const seriesResponse = await fetch(`${basePath(accountId)}${path}?${seriesParams}`);
  const insightsArray = seriesResponse.ok
    ? ((await seriesResponse.json()) as { insightsArray?: InsightsMetrics[] })
        .insightsArray ?? []
    : [];

  const totalParams = new URLSearchParams({ userId });
  if (range.since && range.until) {
    totalParams.set("since", range.since);
    totalParams.set("until", range.until);
  } else if (range.datePreset) {
    totalParams.set("datePreset", range.datePreset);
  } else {
    totalParams.set("datePreset", "last_30d");
  }

  const totalResponse = await fetch(`${basePath(accountId)}${path}?${totalParams}`);
  const total = totalResponse.ok
    ? ((await totalResponse.json()) as { insights?: InsightsMetrics }).insights
    : undefined;

  return { insightsArray, total };
}

export function useCampaignInsights(
  accountId: string,
  userId: string,
  campaignId: string,
  range: InsightsRange,
  options?: { enabled?: boolean },
) {
  return useQuery<InsightsResult>({
    queryKey: marketingKeys.campaignInsights(accountId, userId, campaignId, range),
    enabled:
      options?.enabled !== false &&
      Boolean(accountId) &&
      Boolean(userId) &&
      Boolean(campaignId),
    staleTime: INSIGHTS_STALE_TIME,
    // Spend numbers shift constantly; don't re-bill Meta on every window focus.
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: () =>
      fetchInsights(
        accountId,
        userId,
        `/campaigns/${campaignId}/insights`,
        range,
      ),
  });
}

export function useAdSetInsights(
  accountId: string,
  userId: string,
  adsetId: string,
  range: InsightsRange,
  options?: { enabled?: boolean },
) {
  return useQuery<InsightsResult>({
    queryKey: marketingKeys.adsetInsights(accountId, userId, adsetId, range),
    enabled:
      options?.enabled !== false &&
      Boolean(accountId) &&
      Boolean(userId) &&
      Boolean(adsetId),
    staleTime: INSIGHTS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: () =>
      fetchInsights(accountId, userId, `/adsets/${adsetId}/insights`, range),
  });
}

export function useAdSetDetail(
  accountId: string,
  userId: string,
  adsetId: string,
  options?: {
    adsLimit?: number;
    includeConversion?: boolean;
    enabled?: boolean;
  },
) {
  const includeConversion = options?.includeConversion ?? false;
  const adsLimit = options?.adsLimit ?? 1;
  return useQuery<{
    adset: AdSet | null;
    conversion: AdSetConversionDetails | null;
  }>({
    queryKey: marketingKeys.adsetDetail(
      accountId,
      userId,
      adsetId,
      adsLimit,
      includeConversion,
    ),
    enabled:
      options?.enabled !== false &&
      Boolean(accountId) &&
      Boolean(userId) &&
      Boolean(adsetId),
    queryFn: async () => {
      const params = new URLSearchParams({
        userId,
        adsLimit: String(adsLimit),
      });
      if (includeConversion) {
        params.set("includeConversion", "1");
      }
      const response = await fetch(
        `${basePath(accountId)}/adsets/${adsetId}?${params}`,
      );
      if (!response.ok) {
        throw new Error("Falha ao buscar conjunto de anúncios");
      }
      const data = (await response.json()) as {
        adset?: AdSet;
        conversion?: AdSetConversionDetails;
      };
      return {
        adset: data.adset ?? null,
        conversion: data.conversion ?? null,
      };
    },
  });
}

export function usePromotionLink(
  accountId: string,
  userId: string,
  adId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<string>({
    queryKey: marketingKeys.promotionLink(accountId, userId, adId),
    enabled:
      options?.enabled !== false &&
      Boolean(accountId) &&
      Boolean(userId) &&
      Boolean(adId),
    queryFn: async () => {
      const response = await fetch(
        `${basePath(accountId)}/ads/${adId}/promotion-link?userId=${userId}`,
      );
      const data = (await response.json().catch(() => ({}))) as {
        promotionUrl?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao carregar o link atual");
      }
      return data.promotionUrl ?? "";
    },
  });
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

/**
 * Invalidate every cached query under an (account, user) scope. Meta
 * status/budget changes cascade parent -> children, so the safe default after
 * any mutation is to invalidate the whole subtree. Only mounted (active)
 * queries refetch.
 */
export function invalidateMarketingAccount(
  queryClient: QueryClient,
  accountId: string,
  userId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: marketingKeys.all(accountId, userId),
  });
}

export function useMarketingInvalidate(accountId: string, userId: string) {
  const queryClient = useQueryClient();
  return () => invalidateMarketingAccount(queryClient, accountId, userId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type ToggleContext = { snapshots: Array<[readonly unknown[], unknown]> };

function optimisticStatusUpdate<
  T extends { id: string; status?: unknown; effectiveStatus?: EffectiveStatus },
>(
  queryClient: QueryClient,
  rootKey: readonly unknown[],
  entityId: string,
  status: T["status"],
  effectiveStatus: EffectiveStatus,
): Array<[readonly unknown[], unknown]> {
  const snapshots = queryClient.getQueriesData({ queryKey: rootKey });
  for (const [key, value] of snapshots) {
    const typed = value as { data?: T[]; pagination?: unknown } | undefined;
    if (!typed?.data) continue;
    queryClient.setQueryData(key, {
      ...typed,
      data: typed.data.map((item) =>
        item.id === entityId ? { ...item, status, effectiveStatus } : item,
      ),
    });
  }
  return snapshots;
}

export function useToggleCampaignStatus(accountId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { campaignId: string; nextStatus: CampaignStatus; note: string },
    ToggleContext
  >({
    mutationFn: async ({ campaignId, nextStatus, note }) => {
      const response = await fetch(
        `${basePath(accountId)}/campaigns?userId=${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, status: nextStatus, note }),
        },
      );
      if (!response.ok) {
        // A rota recusa a alteração sem motivo antes de tocar na Meta —
        // a mensagem dela é mais útil do que um erro genérico.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message ?? "Falha ao atualizar status");
      }
    },
    onMutate: async ({ campaignId, nextStatus }) => {
      const rootKey = marketingKeys.campaignListRoot(accountId, userId);
      await queryClient.cancelQueries({ queryKey: rootKey });
      const effectiveStatus =
        nextStatus === CampaignStatus.ACTIVE
          ? EffectiveStatus.ACTIVE
          : EffectiveStatus.PAUSED;
      const snapshots = optimisticStatusUpdate<Campaign>(
        queryClient,
        rootKey,
        campaignId,
        nextStatus,
        effectiveStatus,
      );
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      context?.snapshots.forEach(([key, value]) =>
        queryClient.setQueryData(key, value),
      );
    },
    onSettled: () => invalidateMarketingAccount(queryClient, accountId, userId),
  });
}

export function useToggleAdSetStatus(accountId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { adsetId: string; nextStatus: AdSetStatus; note: string },
    ToggleContext
  >({
    mutationFn: async ({ adsetId, nextStatus, note }) => {
      const response = await fetch(
        `${basePath(accountId)}/adsets?userId=${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adsetId, status: nextStatus, note }),
        },
      );
      if (!response.ok) {
        // A rota recusa a alteração sem motivo antes de tocar na Meta —
        // a mensagem dela é mais útil do que um erro genérico.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message ?? "Falha ao atualizar status");
      }
    },
    onMutate: async ({ adsetId, nextStatus }) => {
      const rootKey = marketingKeys.adsetListRoot(accountId, userId);
      await queryClient.cancelQueries({ queryKey: rootKey });
      const effectiveStatus =
        nextStatus === AdSetStatus.ACTIVE
          ? EffectiveStatus.ACTIVE
          : EffectiveStatus.PAUSED;
      const snapshots = optimisticStatusUpdate<AdSet>(
        queryClient,
        rootKey,
        adsetId,
        nextStatus,
        effectiveStatus,
      );
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      context?.snapshots.forEach(([key, value]) =>
        queryClient.setQueryData(key, value),
      );
    },
    onSettled: () => invalidateMarketingAccount(queryClient, accountId, userId),
  });
}

export function useToggleAdStatus(accountId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { adId: string; nextStatus: AdStatus; note: string },
    ToggleContext
  >({
    mutationFn: async ({ adId, nextStatus, note }) => {
      const response = await fetch(
        `${basePath(accountId)}/ads?userId=${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adId, status: nextStatus, note }),
        },
      );
      if (!response.ok) {
        // A rota recusa a alteração sem motivo antes de tocar na Meta —
        // a mensagem dela é mais útil do que um erro genérico.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message ?? "Falha ao atualizar status");
      }
    },
    onMutate: async ({ adId, nextStatus }) => {
      const rootKey = marketingKeys.adListRoot(accountId, userId);
      await queryClient.cancelQueries({ queryKey: rootKey });
      const effectiveStatus =
        nextStatus === AdStatus.ACTIVE
          ? EffectiveStatus.ACTIVE
          : EffectiveStatus.PAUSED;
      const snapshots = optimisticStatusUpdate<Ad>(
        queryClient,
        rootKey,
        adId,
        nextStatus,
        effectiveStatus,
      );
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      context?.snapshots.forEach(([key, value]) =>
        queryClient.setQueryData(key, value),
      );
    },
    onSettled: () => invalidateMarketingAccount(queryClient, accountId, userId),
  });
}

export { CampaignStatus, AdSetStatus, AdStatus };
