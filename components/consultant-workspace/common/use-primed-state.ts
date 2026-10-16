"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";
import { WORKSPACE_STATE_KEY, useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";

/**
 * A leitura da tela (página do servidor ou resposta em cache das visões) já
 * traz o estado do consultor. Vale o mais novo: o que veio com a leitura
 * (`readAt`) ou o que a aba já tem — uma ação feita depois da leitura
 * (concluir, adiar, nota) nunca é desfeita por um cache mais velho.
 */
export function usePrimedWorkspaceState(initial: WorkspaceState | undefined, readAt: number) {
  const queryClient = useQueryClient();
  const state = useWorkspaceState();
  const cached = queryClient.getQueryState(WORKSPACE_STATE_KEY);
  const seedIsNewer = !!initial && (!cached?.data || cached.dataUpdatedAt < readAt);

  useEffect(() => {
    if (!initial) return;
    const current = queryClient.getQueryState(WORKSPACE_STATE_KEY);
    if (!current?.data || current.dataUpdatedAt < readAt) {
      queryClient.setQueryData(WORKSPACE_STATE_KEY, initial, { updatedAt: readAt });
    }
  }, [initial, readAt, queryClient]);

  return seedIsNewer && initial ? { ...state, store: initial } : state;
}
