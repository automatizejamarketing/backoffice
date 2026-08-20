"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClientPerformanceReportV1 } from "@/lib/performance-report/types";

export type PerformanceReportQueryFilters = {
  accountId?: string;
  campaignId?: string;
  datePreset?: string | null;
  since?: string | null;
  until?: string | null;
};

function buildSearchParams(filters: PerformanceReportQueryFilters): string {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.campaignId) params.set("campaignId", filters.campaignId);
  if (filters.since && filters.until) {
    params.set("since", filters.since);
    params.set("until", filters.until);
  } else if (filters.datePreset) {
    params.set("datePreset", filters.datePreset);
  }
  return params.toString();
}

async function fetchPerformanceReport(
  userId: string,
  filters: PerformanceReportQueryFilters,
): Promise<ClientPerformanceReportV1> {
  const query = buildSearchParams(filters);
  const response = await fetch(
    `/api/users/${userId}/performance-report${query ? `?${query}` : ""}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Falha ao carregar o relatório.");
  }
  return response.json() as Promise<ClientPerformanceReportV1>;
}

export function usePerformanceReport(
  userId: string | null,
  filters: PerformanceReportQueryFilters,
  options?: { enabled?: boolean },
) {
  const query = buildSearchParams(filters);
  return useQuery({
    queryKey: ["performance-report", userId, query],
    enabled: options?.enabled !== false && Boolean(userId),
    queryFn: () => fetchPerformanceReport(userId as string, filters),
    staleTime: 60_000,
  });
}
