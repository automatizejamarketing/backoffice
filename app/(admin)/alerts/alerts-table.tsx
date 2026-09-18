"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  playbookSeverityBadgeClass,
  playbookSeverityRowClass,
  playbookStatusBadgeClass,
} from "./alerts-appearance";
import { AlertDetailSheet } from "./alert-detail-sheet";
import { CompleteAlertButton } from "./complete-alert-button";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

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
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  className={cn("cursor-pointer", playbookSeverityRowClass(row.severity))}
                  data-state={row.id === selectedId ? "selected" : undefined}
                  onClick={() => setSelectedId(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                >
                  <TableCell>
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
                  <TableCell
                    className="text-right"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex justify-end gap-2">
                      {canComplete && isPlaybookPendingStatus(row.status) ? (
                        <CompleteAlertButton
                          userId={row.userId}
                          insightId={row.id}
                          title={row.title}
                        />
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(row.id)}
                      >
                        Abrir
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

      <AlertDetailSheet
        row={selected}
        canWrite={canComplete}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
