"use client";

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AdMediaItem,
  GetAdMediaResponse,
} from "@/lib/meta-business/ad-media-types";

export const adMediaKeys = {
  all: ["ad-media"] as const,
  detail: (accountId: string, userId: string, adId: string) =>
    [...adMediaKeys.all, accountId, userId, adId] as const,
};

const AD_MEDIA_STALE_TIME = 30 * 60 * 1000;

function preloadAdMediaImages(items: AdMediaItem[]) {
  for (const item of items) {
    const url =
      item.kind === "image"
        ? item.previewUrl
        : (item.posterUrl ?? item.previewUrl);
    if (!url) continue;

    const img = new Image();
    img.src = url;
  }
}

export async function fetchAdMedia(
  accountId: string,
  userId: string,
  adId: string,
): Promise<GetAdMediaResponse> {
  const response = await fetch(
    `/api/meta-marketing/${accountId}/ads/${adId}/media?userId=${encodeURIComponent(userId)}`,
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(body.message ?? "Falha ao carregar mídia.");
  }

  const data = (await response.json()) as GetAdMediaResponse;
  preloadAdMediaImages(data.items);
  return data;
}

export function useAdMedia(
  accountId: string,
  userId: string,
  adId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: adMediaKeys.detail(accountId, userId, adId ?? ""),
    queryFn: () => fetchAdMedia(accountId, userId, adId!),
    enabled: enabled && Boolean(adId),
    staleTime: AD_MEDIA_STALE_TIME,
    gcTime: 60 * 60 * 1000,
  });
}

export function prefetchAdMedia(
  queryClient: QueryClient,
  accountId: string,
  userId: string,
  adId: string,
) {
  return queryClient.prefetchQuery({
    queryKey: adMediaKeys.detail(accountId, userId, adId),
    queryFn: () => fetchAdMedia(accountId, userId, adId),
    staleTime: AD_MEDIA_STALE_TIME,
  });
}
