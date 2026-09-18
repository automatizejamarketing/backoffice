"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PLAYBOOK_ALERT_RULE_IDS,
  PLAYBOOK_ALERT_SEVERITIES,
  PLAYBOOK_COMPLETED_STATUSES,
  PLAYBOOK_PENDING_STATUSES,
  playbookAlertHrefWith,
  playbookAlertRuleTitle,
  playbookAlertSeverityLabel,
  playbookAlertStatusLabel,
  type PlaybookAlertFilters,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { useDashboardNavigation } from "../dashboard-navigation-feedback";
import { DashboardDateFilter } from "../dashboard-date-filter";

type ConsultantOption = {
  id: string;
  email: string;
  name: string | null;
};

function extraDateParams(filters: PlaybookAlertFilters) {
  const params: Record<string, string> = {};
  if (filters.tab !== "pending") params.tab = filters.tab;
  if (filters.search) params.q = filters.search;
  if (filters.ruleId !== "all") params.ruleId = filters.ruleId;
  if (filters.severity !== "all") params.severity = filters.severity;
  if (filters.status !== "all") params.status = filters.status;
  if (filters.consultantId !== "all") params.consultantId = filters.consultantId;
  if (filters.pageSize !== 25) params.pageSize = String(filters.pageSize);
  return params;
}

export function AlertsFilters({
  filters,
  consultants,
  showConsultantFilter,
}: {
  filters: PlaybookAlertFilters;
  consultants: ConsultantOption[];
  showConsultantFilter: boolean;
}) {
  const { navigate } = useDashboardNavigation();
  const statusOptions =
    filters.tab === "completed"
      ? PLAYBOOK_COMPLETED_STATUSES
      : PLAYBOOK_PENDING_STATUSES;
  const hasActiveFilters =
    filters.search.length > 0 ||
    filters.ruleId !== "all" ||
    filters.severity !== "all" ||
    filters.status !== "all" ||
    (showConsultantFilter && filters.consultantId !== "all") ||
    filters.window.preset !== "last_30_days";

  function applyPatch(
    patch: Parameters<typeof playbookAlertHrefWith>[1],
  ) {
    navigate(playbookAlertHrefWith(filters, { ...patch, page: 1 }));
  }

  const dateFilter = (
    <div className="space-y-1.5 text-sm">
      <span className="text-muted-foreground">Período</span>
      <DashboardDateFilter
        basePath="/alerts"
        window={filters.window}
        extraParams={extraDateParams(filters)}
      />
    </div>
  );

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        applyPatch({ search: String(form.get("q") ?? "").trim() });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="space-y-1.5 text-sm xl:col-span-2">
          <span className="text-muted-foreground">Buscar</span>
          <Input
            name="q"
            defaultValue={filters.search}
            placeholder="Cliente, empresa, campanha ou alerta"
            className="h-9"
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <Select
            value={filters.ruleId}
            onValueChange={(value) =>
              applyPatch({
                ruleId: value as PlaybookAlertFilters["ruleId"],
              })
            }
          >
            <SelectTrigger className="w-full" aria-label="Tipo do alerta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {PLAYBOOK_ALERT_RULE_IDS.map((ruleId) => (
                  <SelectItem key={ruleId} value={ruleId}>
                    {playbookAlertRuleTitle(ruleId)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Severidade</span>
          <Select
            value={filters.severity}
            onValueChange={(value) =>
              applyPatch({
                severity: value as PlaybookAlertFilters["severity"],
              })
            }
          >
            <SelectTrigger className="w-full" aria-label="Severidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Todas</SelectItem>
                {PLAYBOOK_ALERT_SEVERITIES.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {playbookAlertSeverityLabel(severity)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Status</span>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              applyPatch({
                status: value as PlaybookAlertFilters["status"],
              })
            }
          >
            <SelectTrigger className="w-full" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Todos desta aba</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {playbookAlertStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        {showConsultantFilter ? (
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Consultor</span>
            <Select
              value={filters.consultantId}
              onValueChange={(value) =>
                applyPatch({
                  consultantId: value as PlaybookAlertFilters["consultantId"],
                })
              }
            >
              <SelectTrigger className="w-full" aria-label="Consultor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Todos os consultores</SelectItem>
                  <SelectItem value="unassigned">Sem consultor</SelectItem>
                  {consultants.map((consultant) => (
                    <SelectItem key={consultant.id} value={consultant.id}>
                      {consultant.name
                        ? `${consultant.name} (${consultant.email})`
                        : consultant.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
        ) : (
          dateFilter
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {showConsultantFilter ? dateFilter : <span />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            Buscar
          </Button>
          {hasActiveFilters ? (
            <Button asChild type="button" variant="ghost" size="sm">
              <Link
                href={
                  filters.tab === "pending" ? "/alerts" : "/alerts?tab=completed"
                }
              >
                Limpar filtros
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
