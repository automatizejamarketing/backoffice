"use client";

import { createContext, useContext } from "react";
import { useWorkspaceConsultants } from "@/components/consultant-workspace/shared/use-workspace-consultants";

/** Quem está usando a área de Tráfego (vem do servidor, no layout). */
export type WorkspaceMe = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

const WorkspaceMeContext = createContext<WorkspaceMe | null>(null);

export function WorkspaceMeProvider({ me, children }: { me: WorkspaceMe; children: React.ReactNode }) {
  return <WorkspaceMeContext.Provider value={me}>{children}</WorkspaceMeContext.Provider>;
}

export function useWorkspaceMe(): WorkspaceMe {
  const value = useContext(WorkspaceMeContext);
  if (!value) throw new Error("useWorkspaceMe fora da área de Tráfego");
  return value;
}

/** Primeiro nome ("Gabriela Souza" → "Gabriela"); null se vazio ou se for um e-mail. */
export function firstName(name: string | null | undefined) {
  const value = (name ?? "").trim().split(/\s+/)[0];
  return value && !value.includes("@") ? value : null;
}

/**
 * Como você assina as mensagens ("Aqui é o …"): seu nome no backoffice. Sem
 * nome cadastrado, fica "[seu nome]" para completar antes de mandar.
 */
export function useMySignature(): string {
  const me = useWorkspaceMe();
  const consultants = useWorkspaceConsultants();
  const listed = consultants.data?.consultants.find((consultant) => consultant.id === me.id)?.name;
  return firstName(me.name) ?? firstName(listed) ?? "[seu nome]";
}
