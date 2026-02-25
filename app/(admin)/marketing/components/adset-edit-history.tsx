"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertCircle, CheckCircle2, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdSetEditLogWithAdmin } from "@/lib/db/admin-queries";
import { formatCurrency } from "../utils/formatters";

type AdSetEditHistoryProps = {
  adsetId: string;
  accountId: string;
  refreshTrigger?: number;
};

type GetEditHistoryResponse = {
  logs: AdSetEditLogWithAdmin[];
};

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBudgetChange(
  previous: string | null,
  newValue: string | null
): string | null {
  if (!previous && !newValue) return null;

  const prevBRL = previous ? Number.parseInt(previous) / 100 : null;
  const newBRL = newValue ? Number.parseInt(newValue) / 100 : null;

  if (prevBRL !== null && newBRL !== null) {
    return `${formatCurrency(prevBRL)} → ${formatCurrency(newBRL)}`;
  }
  if (newBRL !== null) {
    return `Definido para ${formatCurrency(newBRL)}`;
  }
  return null;
}

function formatTargetingChange(
  previous: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): string[] {
  const changes: string[] = [];

  if (!previous && !newValue) return changes;

  const prevAgeMin = (previous?.age_min as number) ?? null;
  const newAgeMin = (newValue?.age_min as number) ?? null;
  const prevAgeMax = (previous?.age_max as number) ?? null;
  const newAgeMax = (newValue?.age_max as number) ?? null;

  if (prevAgeMin !== newAgeMin || prevAgeMax !== newAgeMax) {
    const prevRange =
      prevAgeMin && prevAgeMax ? `${prevAgeMin}-${prevAgeMax}` : "N/A";
    const newRange =
      newAgeMin && newAgeMax ? `${newAgeMin}-${newAgeMax}` : "N/A";
    changes.push(`Faixa etária: ${prevRange} → ${newRange}`);
  }

  const prevGenders = (previous?.genders as number[]) ?? [];
  const newGenders = (newValue?.genders as number[]) ?? [];

  const formatGender = (genders: number[]) => {
    if (genders.length === 0) return "Todos";
    if (genders.length === 1 && genders[0] === 1) return "Masculino";
    if (genders.length === 1 && genders[0] === 2) return "Feminino";
    return "Todos";
  };

  if (JSON.stringify(prevGenders) !== JSON.stringify(newGenders)) {
    changes.push(
      `Gênero: ${formatGender(prevGenders)} → ${formatGender(newGenders)}`
    );
  }

  const prevGeo = previous?.geo_locations as
    | { countries?: string[] }
    | undefined;
  const newGeo = newValue?.geo_locations as
    | { countries?: string[] }
    | undefined;

  const prevCountries = prevGeo?.countries ?? [];
  const newCountries = newGeo?.countries ?? [];

  if (JSON.stringify(prevCountries) !== JSON.stringify(newCountries)) {
    const prevStr = prevCountries.length > 0 ? prevCountries.join(", ") : "N/A";
    const newStr = newCountries.length > 0 ? newCountries.join(", ") : "N/A";
    changes.push(`Países: ${prevStr} → ${newStr}`);
  }

  return changes;
}

export function AdSetEditHistory({
  adsetId,
  accountId,
  refreshTrigger,
}: AdSetEditHistoryProps) {
  const [logs, setLogs] = useState<AdSetEditLogWithAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/meta-marketing/${accountId}/adsets/${adsetId}/edit-history`
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar histórico");
      }

      const data: GetEditHistoryResponse = await response.json();
      setLogs(data.logs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao carregar histórico"
      );
    } finally {
      setIsLoading(false);
    }
  }, [adsetId, accountId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-3 w-48 mb-2" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <AlertCircle className="size-8 text-destructive mb-2" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
        <History className="size-8 mb-2 opacity-50" />
        <p className="text-sm">Nenhuma alteração registrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
      {logs.map((log) => {
        const budgetChange = formatBudgetChange(
          log.previousDailyBudget,
          log.newDailyBudget
        );
        const targetingChanges = formatTargetingChange(
          log.previousTargeting,
          log.newTargeting
        );

        return (
          <div
            key={log.id}
            className="rounded-lg border border-border bg-card p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {log.appliedToMeta ? (
                  <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 text-destructive shrink-0" />
                )}
                <span className="text-sm font-medium">
                  {formatDate(log.createdAt)}
                </span>
              </div>
              <Badge
                variant={log.appliedToMeta ? "default" : "destructive"}
                className="text-xs"
              >
                {log.appliedToMeta ? "Aplicado" : "Falhou"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Por: {log.backofficeUserEmail}
            </p>

            <div className="space-y-1">
              {budgetChange && (
                <p className="text-sm">
                  <span className="font-medium">Orçamento:</span> {budgetChange}
                </p>
              )}
              {targetingChanges.map((change, idx) => (
                <p key={idx} className="text-sm">
                  <span className="font-medium">Segmentação:</span> {change}
                </p>
              ))}
            </div>

            <div className="pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground italic">
                &ldquo;{log.note}&rdquo;
              </p>
            </div>

            {!log.appliedToMeta && log.errorMessage && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-destructive">
                  Erro: {log.errorMessage}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
