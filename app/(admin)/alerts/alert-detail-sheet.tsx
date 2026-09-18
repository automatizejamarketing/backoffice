"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PLAYBOOK_DASHBOARD_COMPLETION_NOTE,
  isPlaybookPendingStatus,
  playbookAlertRuleTitle,
  playbookAlertSeverityLabel,
  playbookAlertStatusLabel,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { PlaybookAlertDashboardRow } from "@/lib/db/playbook-alert-dashboard-queries";
import {
  listPlaybookApplyActions,
  type PlaybookApplyActionDef,
} from "@/lib/playbook-insights/actions";

function severityBadgeClass(severity: string) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "";
}

function statusBadgeClass(status: string) {
  if (status === "done") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (status === "dismissed") {
    return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300";
  }
  if (status === "resolved") {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (status === "acknowledged") {
    return "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300";
  }
  return "";
}

const METRIC_LABELS: Array<{ key: string; label: string }> = [
  { key: "purchaseRoas", label: "ROAS" },
  { key: "currentRoas", label: "ROAS atual" },
  { key: "previousRoas", label: "ROAS anterior" },
  { key: "spend", label: "Gasto" },
  { key: "cpa", label: "CPA" },
  { key: "purchases", label: "Compras" },
  { key: "impressions", label: "Impressões" },
  { key: "pausedDays", label: "Dias pausada" },
  { key: "effectiveStatus", label: "Status na Meta" },
];

function formatMetricValue(key: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key.toLowerCase().includes("roas")) return value.toFixed(2);
    if (key === "spend" || key === "cpa") {
      return `R$ ${value.toFixed(2)}`;
    }
    return new Intl.NumberFormat("pt-BR").format(value);
  }
  return String(value);
}

function visibleMetrics(metrics: Record<string, unknown> | null) {
  if (!metrics) return [];
  return METRIC_LABELS.flatMap(({ key, label }) => {
    const formatted = formatMetricValue(key, metrics[key]);
    return formatted ? [{ key, label, value: formatted }] : [];
  });
}

export function AlertDetailSheet({
  row,
  canWrite,
  onClose,
}: {
  row: PlaybookAlertDashboardRow | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        {row ? (
          <AlertDetail row={row} canWrite={canWrite} onClose={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AlertDetail({
  row,
  canWrite,
  onClose,
}: {
  row: PlaybookAlertDashboardRow;
  canWrite: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pending = isPlaybookPendingStatus(row.status);
  const actions = pending ? listPlaybookApplyActions(row) : [];
  const metrics = visibleMetrics(row.metrics);
  const clientLabel = row.userName?.trim() || row.userEmail;
  const [applyAction, setApplyAction] = useState<PlaybookApplyActionDef | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function patchStatus(
    status: "done" | "dismissed",
    reviewNote?: string,
  ) {
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${row.userId}/playbook-insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insightId: row.id,
          status,
          reviewNote: reviewNote ?? null,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Falha ao atualizar o alerta");
      }
      toast.success(
        status === "done"
          ? "Alerta marcado como concluído"
          : "Alerta dispensado",
      );
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao atualizar o alerta",
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!applyAction) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${row.userId}/playbook-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insightId: row.id,
          action: applyAction.id,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        summary?: string;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Falha ao aplicar a sugestão");
      }
      toast.success(body?.summary ?? "Sugestão aplicada");
      setApplyAction(null);
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao aplicar a sugestão",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHeader className="border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={statusBadgeClass(row.status)}>
            {playbookAlertStatusLabel(row.status)}
          </Badge>
          <Badge variant="outline" className={severityBadgeClass(row.severity)}>
            {playbookAlertSeverityLabel(row.severity)}
          </Badge>
        </div>
        <SheetTitle className="text-left text-lg">
          {playbookAlertRuleTitle(row.ruleId)}
        </SheetTitle>
        <SheetDescription className="text-left">
          {clientLabel}
          {row.companyName ? ` · ${row.companyName}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Campanha</p>
          <p className="mt-1 text-sm font-medium">
            {row.entityName ?? "Conta"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Criado em {formatShortDateTimeInSaoPaulo(row.createdAt)}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Evidência</p>
          <p className="mt-1 text-sm leading-relaxed">{row.evidence}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Recomendação
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {row.recommendation}
          </p>
        </div>

        {metrics.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3">
            {metrics.map((metric) => (
              <div key={metric.key}>
                <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                <dd className="mt-0.5 text-sm font-medium tabular-nums">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {canWrite && pending ? (
          <div className="space-y-2">
            {actions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Diagnóstico — não há alteração automática na Meta.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={action.variant}
                  disabled={busy}
                  onClick={() => setApplyAction(action)}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void patchStatus("done", PLAYBOOK_DASHBOARD_COMPLETION_NOTE)
                }
              >
                Concluir
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void patchStatus("dismissed")}
              >
                Dispensar
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 px-4 py-3 sm:px-6">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/users/${row.userId}?tab=marketing`}>
            Ver conta no Marketing
          </Link>
        </Button>
      </div>

      <AlertDialog
        open={applyAction !== null}
        onOpenChange={(open) => {
          if (busy) return;
          if (!open) setApplyAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {applyAction?.confirmTitle ?? "Aplicar na Meta?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {row.entityName ? `“${row.entityName}”. ` : ""}
              {applyAction?.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setApplyAction(null)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={busy} onClick={() => void apply()}>
              {busy ? "Aplicando..." : "Aplicar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
