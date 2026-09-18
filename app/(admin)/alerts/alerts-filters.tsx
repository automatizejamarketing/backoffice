"use client";

import Link from "next/link";
import { Search } from "lucide-react";
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

function extraDateParams(filters: PlaybookAlertFilters) {
  const params: Record<string, string> = {};
  if (filters.tab !== "pending") params.tab = filters.tab;
  if (filters.search) params.q = filters.search;
  if (filters.ruleId !== "all") params.ruleId = filters.ruleId;
  if (filters.severity !== "all") params.severity = filters.severity;
  if (filters.status !== "all") params.status = filters.status;
  if (filters.pageSize !== 25) params.pageSize = String(filters.pageSize);
  return params;
}

export function AlertsFilters({
  filters,
}: {
  filters: PlaybookAlertFilters;
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
    filters.window.preset !== "last_30_days";

  function applyPatch(
    patch: Parameters<typeof playbookAlertHrefWith>[1],
  ) {
    navigate(playbookAlertHrefWith(filters, { ...patch, page: 1 }));
  }

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        applyPatch({ search: String(form.get("q") ?? "").trim() });
      }}
    >
      <div className="relative min-w-0 flex-1 sm:min-w-64 sm:max-w-md">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          key={filters.search}
          name="q"
          defaultValue={filters.search}
          placeholder="Buscar cliente, empresa ou campanha"
          aria-label="Buscar alertas"
          className="h-9 pl-8"
        />
      </div>

      <Select
        value={filters.ruleId}
        onValueChange={(value) =>
          applyPatch({
            ruleId: value as PlaybookAlertFilters["ruleId"],
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Tipo do alerta">
          <SelectValue placeholder="Tipo" />
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

      <Select
        value={filters.severity}
        onValueChange={(value) =>
          applyPatch({
            severity: value as PlaybookAlertFilters["severity"],
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-36" aria-label="Severidade">
          <SelectValue placeholder="Severidade" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">Todas as severidades</SelectItem>
            {PLAYBOOK_ALERT_SEVERITIES.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {playbookAlertSeverityLabel(severity)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(value) =>
          applyPatch({
            status: value as PlaybookAlertFilters["status"],
          })
        }
      >
        <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">Todos os status</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {playbookAlertStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <DashboardDateFilter
        basePath="/alerts"
        window={filters.window}
        extraParams={extraDateParams(filters)}
        label="Período"
        className="h-9 w-full sm:w-56"
      />

      {hasActiveFilters ? (
        <Button asChild type="button" variant="ghost" size="sm" className="h-9">
          <Link
            href={
              filters.tab === "pending" ? "/alerts" : "/alerts?tab=completed"
            }
          >
            Limpar
          </Link>
        </Button>
      ) : null}
    </form>
  );
}
