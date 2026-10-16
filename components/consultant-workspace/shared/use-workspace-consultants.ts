"use client";

import { useQuery } from "@tanstack/react-query";

export type WorkspaceConsultant = { id: string; name: string; email: string };

export type WorkspaceConsultants = {
  me: { id: string; email: string; role: string };
  /** Pode trocar o responsável (users:manage). */
  canAssign: boolean;
  /** Para o filtro de carteira: consultores e quem já tem clientes. */
  consultants: WorkspaceConsultant[];
  /** Quem pode ser responsável (papéis de consultor). */
  assignable: WorkspaceConsultant[];
};

/** Consultores da área de Tráfego, para o filtro "Meus / fulano / Todos" e para atribuir responsável. */
export function useWorkspaceConsultants() {
  return useQuery<WorkspaceConsultants>({
    queryKey: ["consultant-workspace-consultants"],
    queryFn: async () => {
      const response = await fetch("/api/consultant-workspace/consultants", { cache: "no-store" });
      if (!response.ok) throw new Error("Falha ao carregar consultores");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });
}
