"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PlaybookInsightRow = {
  id: string;
  ruleId: string;
  severity: "info" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  entityLevel: "campaign" | "account";
  entityId: string;
  entityName: string;
  actionType: string;
  title: string;
  evidence: string;
  recommendation: string;
  metrics: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type PlaybookInsightStatusUpdate = "acknowledged" | "done" | "dismissed";

const playbookInsightKeys = {
  all: (userId: string) => ["playbook-insights", userId] as const,
};

async function fetchPlaybookInsights(
  userId: string,
): Promise<PlaybookInsightRow[]> {
  const response = await fetch(`/api/users/${userId}/playbook-insights`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load playbook insights");
  }
  const data = (await response.json()) as { insights: PlaybookInsightRow[] };
  return data.insights;
}

export function usePlaybookInsights(
  userId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: playbookInsightKeys.all(userId ?? ""),
    enabled: options?.enabled !== false && Boolean(userId),
    queryFn: () => fetchPlaybookInsights(userId as string),
    staleTime: 60_000,
  });
}

export function useUpdatePlaybookInsightStatus(userId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      insightId: string;
      status: PlaybookInsightStatusUpdate;
      reviewNote?: string | null;
    }) => {
      if (!userId) throw new Error("userId is required");
      const response = await fetch(`/api/users/${userId}/playbook-insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to update playbook insight");
      }
      return response.json() as Promise<{ id: string; status: string }>;
    },
    onSuccess: () => {
      if (!userId) return;
      void queryClient.invalidateQueries({
        queryKey: playbookInsightKeys.all(userId),
      });
    },
  });
}
