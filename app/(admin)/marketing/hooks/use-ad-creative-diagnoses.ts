"use client";

import { useQuery } from "@tanstack/react-query";

import type { AdCreativeDiagnosisMini } from "@/lib/creative-analysis/playground";

import { marketingKeys } from "./marketing-query-keys";

const STALE_TIME = 60_000;

async function fetchAdCreativeDiagnoses(
  accountId: string,
  userId: string,
): Promise<AdCreativeDiagnosisMini[]> {
  const response = await fetch(
    `/api/meta-marketing/${accountId}/creative-diagnoses?userId=${encodeURIComponent(userId)}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Falha ao carregar análises de criativo.");
  }
  const payload = (await response.json()) as {
    diagnoses?: AdCreativeDiagnosisMini[];
  };
  return Array.isArray(payload.diagnoses) ? payload.diagnoses : [];
}

export function useAdCreativeDiagnoses(
  accountId: string,
  userId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: marketingKeys.creativeDiagnoses(accountId, userId),
    queryFn: () => fetchAdCreativeDiagnoses(accountId, userId),
    enabled:
      options?.enabled !== false && Boolean(accountId) && Boolean(userId),
    staleTime: STALE_TIME,
  });
}
