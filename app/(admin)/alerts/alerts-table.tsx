"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
} from "lucide-react";
import { groupPlaybookAlerts } from "@/lib/backoffice/playbook-alert-groups";
import { AlertMarketingLink } from "./alert-marketing-link";
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
  const groups = groupPlaybookAlerts(rows);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const hasPrevious = filters.page > 1;
  const hasNext = filters.page < totalPages;
  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = (filters.page - 1) * filters.pageSize + groups.length;
  const showCompletedAt = filters.tab === "completed";
  const colSpan = 6 + (showCompletedAt ? 1 : 0);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selected =
    groups.find((group) => group.userId === selectedUserId) ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(userId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Alertas</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Campanhas</TableHead>
              <TableHead>Mais recente</TableHead>
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
              groups.map((group) => {
                const row = group.alerts[0];
                const clientLabel = row.userName?.trim() || row.userEmail;
                const isExpanded = expanded.has(group.userId);
                const campaignCount = new Set(
                  group.alerts
                    .filter((alert) => alert.entityLevel !== "account")
                    .map((alert) => alert.entityId),
                ).size;
                return (
                  <Fragment key={group.userId}>
                    <TableRow
                      className={cn(
                        "cursor-pointer [&>td]:py-4",
                        playbookSeverityRowClass(group.severity),
                      )}
                      onClick={() => toggle(group.userId)}
                    >
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            ...new Set(
                              group.alerts.map((alert) => alert.status),
                            ),
                          ].map((status) => (
                            <Badge
                              key={status}
                              variant="secondary"
                              className={playbookStatusBadgeClass(status)}
                            >
                              {playbookAlertStatusLabel(status)}
                            </Badge>
                          ))}
                          <Badge
                            variant="secondary"
                            className={playbookSeverityBadgeClass(
                              group.severity,
                            )}
                          >
                            {playbookAlertSeverityLabel(group.severity)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2 font-semibold"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Recolher" : "Expandir"} alertas de ${clientLabel}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(group.userId);
                          }}
                        >
                          <ChevronDown
                            className={cn(
                              "size-4 transition-transform",
                              !isExpanded && "-rotate-90",
                            )}
                          />
                          {group.alerts.length} alerta(s)
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {
                            new Set(group.alerts.map((alert) => alert.ruleId))
                              .size
                          }{" "}
                          tipo(s)
                        </p>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate text-sm font-semibold">
                          {clientLabel}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.companyName ?? row.userEmail}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {campaignCount > 0
                          ? `${campaignCount} campanha(s)`
                          : "Conta"}
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
                          {canComplete && group.pendingIds.length > 0 ? (
                            <CompleteAlertButton
                              userId={group.userId}
                              insightIds={group.pendingIds}
                              title={clientLabel}
                            />
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedUserId(group.userId)}
                          >
                            Abrir
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded
                      ? group.alerts.map((row, index) => (
                          <TableRow
                            key={row.id}
                            tabIndex={0}
                            className={cn(
                              "cursor-pointer border-l-2 border-l-border bg-muted/40 hover:bg-muted/70 [&>td]:py-3",
                              index === group.alerts.length - 1 &&
                                "border-b-2 border-b-border",
                            )}
                            onClick={() => setSelectedUserId(row.userId)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedUserId(row.userId);
                              }
                            }}
                          >
                            <TableCell className="pl-8">
                              <div className="flex items-center gap-3">
                                <CornerDownRight
                                  aria-hidden="true"
                                  className="size-4 shrink-0 text-muted-foreground"
                                />
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge
                                    variant="secondary"
                                    className={playbookStatusBadgeClass(
                                      row.status,
                                    )}
                                  >
                                    {playbookAlertStatusLabel(row.status)}
                                  </Badge>
                                  <Badge
                                    variant="secondary"
                                    className={playbookSeverityBadgeClass(
                                      row.severity,
                                    )}
                                  >
                                    {playbookAlertSeverityLabel(row.severity)}
                                  </Badge>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-56">
                              <p className="text-sm font-medium">
                                {row.ruleTitle}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {row.title}
                              </p>
                            </TableCell>
                            <TableCell className="max-w-56">
                              <p className="truncate text-xs text-muted-foreground">
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
                                  ? formatShortDateTimeInSaoPaulo(
                                      row.completedAt,
                                    )
                                  : "—"}
                              </TableCell>
                            ) : null}
                            <TableCell
                              className="text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex justify-end gap-2">
                                {canComplete &&
                                isPlaybookPendingStatus(row.status) ? (
                                  <CompleteAlertButton
                                    userId={row.userId}
                                    insightId={row.id}
                                    title={row.title}
                                  />
                                ) : null}
                                <AlertMarketingLink row={row} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Mostrando {from}–{to} de {total} clientes · {rows.length} alerta(s)
          nesta página
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
        group={selected}
        canWrite={canComplete}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}
