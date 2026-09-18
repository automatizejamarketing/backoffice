import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  isPlaybookPendingStatus,
  playbookAlertHrefWith,
  playbookAlertSeverityLabel,
  playbookAlertStatusLabel,
  type PlaybookAlertFilters,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { PlaybookAlertDashboardRow } from "@/lib/db/playbook-alert-dashboard-queries";
import { CompleteAlertButton } from "./complete-alert-button";

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

export function AlertsTable({
  filters,
  rows,
  total,
  canComplete,
}: {
  filters: PlaybookAlertFilters;
  rows: PlaybookAlertDashboardRow[];
  total: number;
  canComplete: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const hasPrevious = filters.page > 1;
  const hasNext = filters.page < totalPages;
  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = (filters.page - 1) * filters.pageSize + rows.length;
  const showCompletedAt = filters.tab === "completed";
  const colSpan = 6 + (showCompletedAt ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead>Criado</TableHead>
              {showCompletedAt ? <TableHead>Finalizado</TableHead> : null}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {filters.tab === "pending"
                    ? "Nenhum alerta pendente para este filtro."
                    : "Nenhum alerta finalizado neste período."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className={statusBadgeClass(row.status)}
                      >
                        {playbookAlertStatusLabel(row.status)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={severityBadgeClass(row.severity)}
                      >
                        {playbookAlertSeverityLabel(row.severity)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56">
                    <p className="text-sm font-medium">{row.ruleTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.title}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-56">
                    <p className="truncate text-sm font-medium">
                      {row.userName?.trim() || row.userEmail}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.companyName ?? row.userEmail}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-48">
                    <p className="truncate text-sm">
                      {row.entityName ?? "Conta"}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {formatShortDateTimeInSaoPaulo(row.createdAt)}
                  </TableCell>
                  {showCompletedAt ? (
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {row.completedAt
                        ? formatShortDateTimeInSaoPaulo(row.completedAt)
                        : "—"}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canComplete && isPlaybookPendingStatus(row.status) ? (
                        <CompleteAlertButton
                          userId={row.userId}
                          insightId={row.id}
                          title={row.title}
                        />
                      ) : null}
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/users/${row.userId}?tab=marketing`}>
                          Abrir
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Mostrando {from}–{to} de {total}
        </p>
        {totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={!hasPrevious}
              className={!hasPrevious ? "pointer-events-none opacity-50" : ""}
            >
              <Link
                href={
                  hasPrevious
                    ? playbookAlertHrefWith(filters, { page: filters.page - 1 })
                    : "#"
                }
              >
                <ChevronLeft className="size-4" />
                Anterior
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Página {filters.page} de {totalPages}
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={!hasNext}
              className={!hasNext ? "pointer-events-none opacity-50" : ""}
            >
              <Link
                href={
                  hasNext
                    ? playbookAlertHrefWith(filters, { page: filters.page + 1 })
                    : "#"
                }
              >
                Próxima
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
