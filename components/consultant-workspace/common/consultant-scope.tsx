"use client";

import { useCallback, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useWorkspaceConsultants } from "@/components/consultant-workspace/shared/use-workspace-consultants";
import { useLocalPref } from "./prefs";
import { useWorkspaceMe } from "./workspace-context";

/**
 * "Carteira de": Meus, um consultor, Sem responsável ou Todos. Vale para as
 * três visões (lembrado neste navegador). O consultor comum começa em Meus;
 * premium, dev e admin começam em Todos.
 */
export type ConsultantScope = "meus" | "todos" | "sem" | (string & {});

const STORAGE_KEY = "trafego:carteira-de";
const KEYWORDS = new Set(["meus", "todos", "sem"]);

export function defaultScopeFor(role: string): ConsultantScope {
  return role === "marketing_consultant" ? "meus" : "todos";
}

export function scopeMatches(scope: ConsultantScope, consultantKey: string | null, meId: string) {
  if (scope === "todos") return true;
  if (scope === "meus") return consultantKey === meId;
  if (scope === "sem") return consultantKey == null;
  return consultantKey === scope;
}

export function useConsultantScope() {
  const me = useWorkspaceMe();
  const consultants = useWorkspaceConsultants();
  const fallback = defaultScopeFor(me.role);
  const [stored, setStored] = useLocalPref<string | null>(STORAGE_KEY, null);
  const list = consultants.data?.consultants;
  // Consultor que saiu da lista (desativado): volta ao padrão.
  const scope: ConsultantScope =
    stored && (KEYWORDS.has(stored) || !list || list.some((consultant) => consultant.id === stored)) ? stored : fallback;
  const setScope = useCallback(
    (next: ConsultantScope) => setStored(next === fallback ? null : next),
    [fallback, setStored],
  );
  const matches = useCallback((consultantKey: string | null) => scopeMatches(scope, consultantKey, me.id), [scope, me.id]);
  const label = useMemo(() => {
    if (scope === "todos") return "Todos";
    if (scope === "meus") return "Meus clientes";
    if (scope === "sem") return "Sem responsável";
    return list?.find((consultant) => consultant.id === scope)?.name ?? "Consultor";
  }, [scope, list]);
  return { scope, setScope, matches, label, filtered: scope !== "todos" };
}

export function ConsultantScopeSelect({ className }: { className?: string }) {
  const me = useWorkspaceMe();
  const { scope, setScope, label } = useConsultantScope();
  const consultants = useWorkspaceConsultants();
  const others = (consultants.data?.consultants ?? []).filter((consultant) => consultant.id !== me.id);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground xl:inline">Carteira de</span>
      <Select value={scope} onValueChange={(value) => setScope(value)}>
        <SelectTrigger className="w-[170px] text-xs data-[size=default]:h-8" aria-label="Carteira de">
          {/* Rótulo explícito: sem ele o Select só mostra o texto depois de abrir a lista uma vez. */}
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="meus" className="text-xs">
            Meus clientes
          </SelectItem>
          <SelectItem value="todos" className="text-xs">
            Todos
          </SelectItem>
          <SelectItem value="sem" className="text-xs">
            Sem responsável
          </SelectItem>
          {others.length > 0 ? <SelectSeparator /> : null}
          {others.map((consultant) => (
            <SelectItem key={consultant.id} value={consultant.id} className="text-xs">
              {consultant.name}
            </SelectItem>
          ))}
          {/* Valor guardado de um consultor que ainda não carregou: mantém o rótulo enquanto a lista chega. */}
          {!KEYWORDS.has(scope) && !others.some((consultant) => consultant.id === scope) ? (
            <SelectItem value={scope} className="hidden text-xs">
              Consultor
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
