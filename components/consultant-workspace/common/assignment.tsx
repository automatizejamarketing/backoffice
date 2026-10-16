"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useWorkspaceConsultants } from "@/components/consultant-workspace/shared/use-workspace-consultants";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";

/**
 * Troca de responsável. A leitura da carteira no servidor guarda alguns
 * minutos de cache, então a troca feita aqui vale na hora para as telas
 * abertas nesta aba.
 */
export type AssignedConsultant = { id: string | null; name: string | null };

let overrides = new Map<string, AssignedConsultant>();
const EMPTY = new Map<string, AssignedConsultant>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setOverride(userId: string, value: AssignedConsultant) {
  overrides = new Map(overrides);
  overrides.set(userId, value);
  for (const listener of listeners) listener();
}

export function useAssignmentOverrides() {
  return useSyncExternalStore(
    subscribe,
    () => overrides,
    () => EMPTY,
  );
}

/** Responsável atual de um cliente, já com a troca feita nesta aba. */
export function useAssignedConsultant(userId: string, fromServer: AssignedConsultant): AssignedConsultant {
  const map = useAssignmentOverrides();
  return map.get(userId) ?? fromServer;
}

const NOBODY = "__ninguem__";

function useAssign(userId: string, clientName: string) {
  const { apply, isSaving } = useWorkspaceState();
  const consultants = useWorkspaceConsultants();
  async function assign(value: string) {
    const id = value === NOBODY ? null : value;
    const consultant = consultants.data?.assignable.find((entry) => entry.id === id) ?? null;
    await apply({ op: "assign", userId, consultant: id });
    setOverride(userId, { id, name: consultant?.name ?? null });
    toast.success(consultant ? `${clientName} agora é de ${consultant.name}` : `${clientName} ficou sem responsável`);
  }
  return {
    assign,
    isSaving,
    canAssign: consultants.data?.canAssign ?? false,
    assignable: consultants.data?.assignable ?? [],
  };
}

/**
 * Responsável do cliente: seletor para quem pode atribuir (users:manage),
 * texto para os demais.
 */
export function AssignConsultant({
  userId,
  clientName,
  current,
  variant = "select",
  className,
}: {
  userId: string;
  clientName: string;
  current: AssignedConsultant;
  variant?: "select" | "menu";
  className?: string;
}) {
  const { assign, isSaving, canAssign, assignable } = useAssign(userId, clientName);
  const label = current.name ?? (current.id ? "Consultor" : null);
  if (!canAssign) {
    return (
      <span className={cn(!label && "text-muted-foreground", className)}>{label ?? "Sem responsável"}</span>
    );
  }
  // Responsável atual que não está entre os atribuíveis (ex.: admin com carteira): continua aparecendo.
  const options =
    current.id && !assignable.some((entry) => entry.id === current.id)
      ? [...assignable, { id: current.id, name: label ?? "Consultor", email: "" }]
      : assignable;
  const value = current.id ?? NOBODY;

  if (variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isSaving}
          className={cn(
            "-mx-1 max-w-36 truncate rounded px-1 py-0.5 text-left hover:bg-background",
            !label && "text-muted-foreground",
            className,
          )}
        >
          {label ?? "Atribuir"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            Responsável por {clientName}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => void assign(next).catch(() => undefined)}>
            {options.map((entry) => (
              <DropdownMenuRadioItem key={entry.id} value={entry.id} className="text-xs">
                {entry.name}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={NOBODY} className="text-xs text-muted-foreground">
              Sem responsável
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Select value={value} onValueChange={(next) => void assign(next).catch(() => undefined)} disabled={isSaving}>
      <SelectTrigger
        className={cn("w-40 text-xs data-[size=default]:h-7", className)}
        aria-label={`Responsável por ${clientName}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((entry) => (
          <SelectItem key={entry.id} value={entry.id} className="text-xs">
            {entry.name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NOBODY} className="text-xs">
          Sem responsável
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
