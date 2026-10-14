"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";
import { WORKSPACE_STATE_KEY, useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";

/**
 * O servidor já leu o estado do consultor ao montar a página: semeia o cache
 * para a primeira pintura sair completa — só se for mais novo que o que a aba
 * já tem (voltar pelo histórico reaproveita páginas antigas).
 */
export function usePrimedWorkspaceState(initial: WorkspaceState | undefined, readAt: number) {
  const queryClient = useQueryClient();
  useState(() => {
    const current = queryClient.getQueryState(WORKSPACE_STATE_KEY);
    if (initial && (!current?.data || current.dataUpdatedAt < readAt)) {
      queryClient.setQueryData(WORKSPACE_STATE_KEY, initial, { updatedAt: readAt });
    }
    return null;
  });
  return useWorkspaceState();
}
