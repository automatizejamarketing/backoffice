"use client";

import { useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Clock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanBadge, SeverityDot } from "@/components/consultant-workspace/shared/primitives";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import type { ConsultantKey, PlanTier, WorkspaceState } from "@/lib/consultant-workspace/types";
import { useAssignmentOverrides } from "@/components/consultant-workspace/common/assignment";
import { useConsultantScope } from "@/components/consultant-workspace/common/consultant-scope";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import { clientHref } from "@/components/consultant-workspace/common/routes";
import {
  SYNTHETIC_TITLE,
  entityLabel,
  formatDateShort,
  humanize,
  isSnoozed,
  syntheticKindOf,
  syntheticUserOf,
  type Severity,
} from "@/components/consultant-workspace/common/signal-helpers";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";

export type SnoozedClient = {
  userId: string;
  displayName: string;
  tier: PlanTier;
  consultant: { key: ConsultantKey | null; name: string | null };
};

export type SnoozedAlert = {
  id: string;
  userId: string;
  ruleTitle: string;
  severity: Severity;
  entityLevel: string;
  entityName: string | null;
  evidence: string;
};

type SnoozedEntry = { key: string; title: string; detail: string | null; severity: Severity };
type SnoozedGroup = { userId: string; until: string; at: string; entries: SnoozedEntry[] };

/** Tudo o que foi adiado na carteira, por cliente, com "Trazer agora". */
export function SnoozedView({
  clients,
  alerts,
  initialStore,
  now,
}: {
  clients: SnoozedClient[];
  alerts: SnoozedAlert[];
  initialStore: WorkspaceState;
  now: number;
}) {
  const { store, apply, isSaving } = usePrimedWorkspaceState(initialStore, now);
  const scope = useConsultantScope();
  const assignments = useAssignmentOverrides();
  useRememberView("adiados");

  const clientById = useMemo(() => new Map(clients.map((client) => [client.userId, client])), [clients]);
  const alertById = useMemo(() => new Map(alerts.map((alert) => [alert.id, alert])), [alerts]);

  const groups = useMemo(() => {
    const byUser = new Map<string, SnoozedGroup>();
    for (const [key, action] of Object.entries(store.alertActions)) {
      if (!isSnoozed(action, now) || !action.snoozeUntil) continue;
      const alert = alertById.get(key);
      const userId = syntheticUserOf(key) ?? alert?.userId;
      if (!userId || !clientById.has(userId)) continue;
      const group = byUser.get(userId) ?? { userId, until: action.snoozeUntil, at: action.at, entries: [] };
      if (action.snoozeUntil < group.until) group.until = action.snoozeUntil;
      const kind = syntheticKindOf(key);
      group.entries.push(
        alert
          ? {
              key,
              title: alert.ruleTitle,
              detail: entityLabel({ alert }) ?? humanize(alert.evidence).slice(0, 120),
              severity: alert.severity,
            }
          : { key, title: kind ? SYNTHETIC_TITLE[kind] : "Sinal", detail: null, severity: "warning" },
      );
      byUser.set(userId, group);
    }
    return [...byUser.values()]
      .filter((group) => {
        const client = clientById.get(group.userId);
        const assigned = assignments.get(group.userId);
        return scope.matches(assigned ? assigned.id : (client?.consultant.key ?? null));
      })
      .sort((a, b) => a.until.localeCompare(b.until));
  }, [store, now, alertById, clientById, assignments, scope]);

  async function wake(group: SnoozedGroup) {
    try {
      await apply({ op: "clearAlertAction", insightIds: group.entries.map((entry) => entry.key) });
      toast.success("De volta na Fila");
    } catch {
      // o erro já apareceu no aviso
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 lg:px-6">
      <Link href="/trafego/fila" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Fila
      </Link>
      <header>
        <h1 className="text-lg font-semibold">Adiados</h1>
        <p className="text-sm text-muted-foreground">
          Voltam sozinhos para a Fila às 8h do dia marcado. Nada se perde.
          {scope.filtered ? ` Carteira: ${scope.label}.` : ""}
        </p>
      </header>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          <Clock className="size-6" />
          <p className="text-sm">
            Nada adiado. Na Fila, aperte <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">s</kbd> para
            adiar um cliente.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {groups.map((group) => {
            const client = clientById.get(group.userId);
            return (
              <li key={group.userId} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Link href={clientHref(group.userId)} className="truncate font-medium hover:underline">
                      {client?.displayName ?? "Cliente"}
                    </Link>
                    {client ? <PlanBadge tier={client.tier} /> : null}
                  </div>
                  <ul className="space-y-0.5">
                    {group.entries.map((entry) => (
                      <li key={entry.key} className="flex min-w-0 items-center gap-2 text-sm">
                        <SeverityDot severity={entry.severity} />
                        <span className="shrink-0">{entry.title}</span>
                        {entry.detail ? (
                          <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.detail}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">Adiado {formatRelative(group.at, now)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs">Volta {formatDateShort(group.until)}</span>
                  <Button size="sm" variant="outline" disabled={isSaving} onClick={() => wake(group)}>
                    <Undo2 className="size-3.5" /> Trazer agora
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
