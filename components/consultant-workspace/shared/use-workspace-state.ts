"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkspaceOp, WorkspaceState } from "@/lib/consultant-workspace/types";

export const WORKSPACE_STATE_KEY = ["consultant-workspace-state"];

const EMPTY: WorkspaceState = {
  goals: {},
  notes: [],
  alertActions: {},
  simulatedActions: [],
  assignments: {},
  handoffs: {},
  clientTags: {},
  dismissedAutoTags: {},
  sentMessages: [],
  aiAnalyses: {},
  tasks: [],
};

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Estado do consultor (metas, linha do tempo, tags, alertas tratados), lido e gravado no banco. */
export function useWorkspaceState() {
  const queryClient = useQueryClient();
  const query = useQuery<WorkspaceState>({
    queryKey: WORKSPACE_STATE_KEY,
    queryFn: async () => {
      const response = await fetch("/api/consultant-workspace/state", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Falha ao carregar"));
      return response.json();
    },
    staleTime: 30_000,
    // Acompanha o cache das visões (30 min): voltar a uma visão não pinta com estado velho.
    gcTime: 30 * 60_000,
  });
  const mutation = useMutation({
    mutationFn: async (op: WorkspaceOp) => {
      const response = await fetch("/api/consultant-workspace/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op),
      });
      if (!response.ok) throw new Error(await readError(response, "Falha ao salvar"));
      return (await response.json()) as WorkspaceState;
    },
    onSuccess: (state) => queryClient.setQueryData(WORKSPACE_STATE_KEY, state),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro"),
  });
  return {
    store: query.data ?? EMPTY,
    isLoading: query.isLoading,
    apply: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
