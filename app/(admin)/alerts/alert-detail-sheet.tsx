"use client";

import { useState } from "react";
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
import type { PlaybookAlertGroup } from "@/lib/backoffice/playbook-alert-groups";
import { CompleteAlertButton } from "./complete-alert-button";
import { AlertMarketingLink } from "./alert-marketing-link";
import { cn } from "@/lib/utils";
import {
  listPlaybookApplyActions,
  type PlaybookApplyActionDef,
} from "@/lib/playbook-insights/actions";
import {
  playbookSeverityBadgeClass,
  playbookSeveritySheetClass,
  playbookStatusBadgeClass,
} from "./alerts-appearance";

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
  group,
  canWrite,
  onClose,
}: {
  group: PlaybookAlertGroup<PlaybookAlertDashboardRow> | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl lg:max-w-[52rem]">
        {group ? (
          <>
            <SheetHeader className="border-b px-4 py-6 sm:px-8">
              <SheetTitle className="pr-6 text-left">
                {group.alerts[0].userName?.trim() || group.alerts[0].userEmail}
              </SheetTitle>
              <SheetDescription className="text-left">
                {group.alerts[0].companyName ?? group.alerts[0].userEmail} ·{" "}
                {group.alerts.length} alerta(s)
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-8">
              {group.alerts.map((row) => (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-xl border"
                >
                  <AlertDetail row={row} canWrite={canWrite} />
                </article>
              ))}
            </div>
            {canWrite && group.pendingIds.length > 0 ? (
              <div className="border-t px-4 py-4 sm:px-8">
                <CompleteAlertButton
                  userId={group.userId}
                  insightIds={group.pendingIds}
                  title={
                    group.alerts[0].userName?.trim() ||
                    group.alerts[0].userEmail
                  }
                />
              </div>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AlertDetail({
  row,
  canWrite,
}: {
  row: PlaybookAlertDashboardRow;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pending = isPlaybookPendingStatus(row.status);
  const actions = pending ? listPlaybookApplyActions(row) : [];
  const metrics = visibleMetrics(row.metrics);
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
      const response = await fetch(
        `/api/users/${row.userId}/playbook-insights`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            insightId: row.id,
            status,
            reviewNote: reviewNote ?? null,
          }),
        },
      );
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
      const response = await fetch(
        `/api/users/${row.userId}/playbook-insights`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            insightId: row.id,
            action: applyAction.id,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        summary?: string;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Falha ao aplicar a sugestão");
      }
      toast.success(body?.summary ?? "Sugestão aplicada");
      setApplyAction(null);
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
      <div
        className={cn(
          "border-b px-4 py-4 sm:px-6",
          playbookSeveritySheetClass(row.severity),
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="secondary"
            className={playbookStatusBadgeClass(row.status)}
          >
            {playbookAlertStatusLabel(row.status)}
          </Badge>
          <Badge
            variant="secondary"
            className={playbookSeverityBadgeClass(row.severity)}
          >
            {playbookAlertSeverityLabel(row.severity)}
          </Badge>
        </div>
        <h3 className="mt-2 text-left text-base font-semibold">
          {playbookAlertRuleTitle(row.ruleId)}
        </h3>
      </div>

      <div className="space-y-6 px-4 py-6 sm:px-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Campanha</p>
          <p className="mt-1 text-sm font-medium">
            {row.entityName ?? "Conta"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Criado em {formatShortDateTimeInSaoPaulo(row.createdAt)}
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Evidência
          </p>
          <p className="mt-1 text-sm leading-relaxed">{row.evidence}</p>
        </div>

        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Recomendação
          </p>
          <p className="mt-1 text-sm leading-relaxed">{row.recommendation}</p>
        </div>

        {metrics.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2"
              >
                <dt className="text-xs text-sky-800 dark:text-sky-300">
                  {metric.label}
                </dt>
                <dd className="mt-0.5 text-sm font-medium tabular-nums">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="space-y-2">
          {canWrite && pending && actions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Diagnóstico — não há alteração automática na Meta.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {canWrite && pending ? (
              <div className="flex min-w-0 flex-wrap gap-2">
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
            ) : null}
            <div className="ml-auto shrink-0">
              <AlertMarketingLink row={row} />
            </div>
          </div>
        </div>
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
