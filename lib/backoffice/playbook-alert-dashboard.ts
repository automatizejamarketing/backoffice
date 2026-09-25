import {
  resolveDashboardDateWindow,
  shiftCalendarDate,
  type DashboardDateWindow,
} from "@/lib/backoffice/dashboard-date-range";
import { firstSearchParam } from "@/lib/backoffice/filter-params";
import {
  type BackofficeActor,
  isMarketingConsultantRole,
} from "@/lib/auth/rbac-core";
import { PROACTIVITY_ALERT_DEFINITIONS } from "@/lib/proactivity/catalog";
import {
  PLAYBOOK_INSIGHTS_RULE_PREFIX,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_DECLINE,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "@/lib/playbook-insights/constants";

export const PLAYBOOK_ALERT_DEFAULT_PAGE_SIZE = 25;
export const PLAYBOOK_ALERT_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const PLAYBOOK_ALERT_TAB_VALUES = ["pending", "completed"] as const;
export type PlaybookAlertTab = (typeof PLAYBOOK_ALERT_TAB_VALUES)[number];

export const PLAYBOOK_PENDING_STATUSES = ["open", "acknowledged"] as const;
export const PLAYBOOK_COMPLETED_STATUSES = [
  "done",
  "dismissed",
  "resolved",
] as const;
export const PLAYBOOK_ALERT_STATUSES = [
  ...PLAYBOOK_PENDING_STATUSES,
  ...PLAYBOOK_COMPLETED_STATUSES,
] as const;

export type PlaybookPendingStatus = (typeof PLAYBOOK_PENDING_STATUSES)[number];
export type PlaybookCompletedStatus =
  (typeof PLAYBOOK_COMPLETED_STATUSES)[number];
export type PlaybookAlertStatus = (typeof PLAYBOOK_ALERT_STATUSES)[number];

export const PLAYBOOK_ALERT_SEVERITIES = [
  "critical",
  "warning",
  "info",
] as const;
export type PlaybookAlertSeverity = (typeof PLAYBOOK_ALERT_SEVERITIES)[number];

export const PLAYBOOK_ALERT_RULE_IDS = [
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_DECLINE,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
] as const;
export type PlaybookAlertRuleId = (typeof PLAYBOOK_ALERT_RULE_IDS)[number];

export const PLAYBOOK_DASHBOARD_COMPLETION_NOTE =
  "Concluído no dashboard de alertas";

export type PlaybookAlertSearchParams = {
  tab?: string | string[];
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
  q?: string | string[];
  ruleId?: string | string[];
  severity?: string | string[];
  status?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
};

export type PlaybookAlertFilters = {
  tab: PlaybookAlertTab;
  window: DashboardDateWindow;
  search: string;
  ruleId: PlaybookAlertRuleId | "all";
  severity: PlaybookAlertSeverity | "all";
  status: PlaybookAlertStatus | "all";
  page: number;
  pageSize: number;
};

export type PlaybookAlertKpis = {
  created: number;
  completed: number;
  treatmentRate: number;
};

export type PlaybookAlertComparison = {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
};

export type PlaybookAlertAccessScope =
  | { kind: "consultant"; consultantId: string }
  | { kind: "all" };

const RULE_TITLE_BY_ID = new Map(
  PROACTIVITY_ALERT_DEFINITIONS.filter(
    (definition) =>
      definition.audience === "consultant" && definition.playbookRuleId,
  ).map((definition) => [definition.playbookRuleId as string, definition.title]),
);

function isPlaybookAlertTab(value: string): value is PlaybookAlertTab {
  return (PLAYBOOK_ALERT_TAB_VALUES as readonly string[]).includes(value);
}

function isPlaybookAlertRuleId(value: string): value is PlaybookAlertRuleId {
  return (PLAYBOOK_ALERT_RULE_IDS as readonly string[]).includes(value);
}

function isPlaybookAlertSeverity(value: string): value is PlaybookAlertSeverity {
  return (PLAYBOOK_ALERT_SEVERITIES as readonly string[]).includes(value);
}

function isPlaybookAlertStatus(value: string): value is PlaybookAlertStatus {
  return (PLAYBOOK_ALERT_STATUSES as readonly string[]).includes(value);
}

export function isPlaybookPendingStatus(
  value: string,
): value is PlaybookPendingStatus {
  return (PLAYBOOK_PENDING_STATUSES as readonly string[]).includes(value);
}

export function isPlaybookCompletedStatus(
  value: string,
): value is PlaybookCompletedStatus {
  return (PLAYBOOK_COMPLETED_STATUSES as readonly string[]).includes(value);
}

export function playbookAlertTabForStatus(status: string): PlaybookAlertTab {
  return isPlaybookCompletedStatus(status) ? "completed" : "pending";
}

export function sourceStatusesForPlaybookUpdate(
  nextStatus: "acknowledged" | "done" | "dismissed",
): readonly PlaybookPendingStatus[] {
  if (nextStatus === "acknowledged") return ["open"];
  return PLAYBOOK_PENDING_STATUSES;
}

export function playbookAlertRuleTitle(ruleId: string): string {
  return RULE_TITLE_BY_ID.get(ruleId) ?? ruleId.replace(PLAYBOOK_INSIGHTS_RULE_PREFIX, "");
}

export function playbookAlertStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Aberto";
    case "acknowledged":
      return "Em andamento";
    case "done":
      return "Concluído";
    case "dismissed":
      return "Dispensado";
    case "resolved":
      return "Resolvido automaticamente";
    default:
      return status;
  }
}

export function playbookAlertSeverityLabel(severity: string): string {
  switch (severity) {
    case "critical":
      return "Crítico";
    case "warning":
      return "Atenção";
    case "info":
      return "Info";
    default:
      return severity;
  }
}

export function calendarDayCount(fromDate: string, throughDate: string): number {
  const from = Date.parse(`${fromDate}T12:00:00.000Z`);
  const through = Date.parse(`${throughDate}T12:00:00.000Z`);
  return Math.max(1, Math.round((through - from) / 86_400_000) + 1);
}

export function previousEquivalentWindow(
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
): DashboardDateWindow {
  const days = calendarDayCount(window.fromDate, window.throughDate);
  const throughDate = shiftCalendarDate(window.fromDate, -1);
  const fromDate = shiftCalendarDate(window.fromDate, -days);
  return resolveDashboardDateWindow(
    { range: "custom", from: fromDate, to: throughDate },
    new Date(`${throughDate}T15:00:00.000Z`),
  );
}

export function comparePlaybookAlertMetric(
  current: number,
  previous: number,
): PlaybookAlertComparison {
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    deltaPercent:
      previous === 0 ? (current === 0 ? 0 : null) : Math.round((delta / previous) * 1000) / 10,
  };
}

export function treatmentRate(created: number, completedOfCreated: number): number {
  if (created === 0) return 0;
  return Math.round((completedOfCreated / created) * 1000) / 10;
}

export function emptyPlaybookAlertKpis(): PlaybookAlertKpis {
  return { created: 0, completed: 0, treatmentRate: 0 };
}

export function resolvePlaybookAlertAccessScope(
  actor: BackofficeActor,
): PlaybookAlertAccessScope {
  if (isMarketingConsultantRole(actor.role)) {
    return { kind: "consultant", consultantId: actor.id };
  }
  return { kind: "all" };
}

export function statusesForPlaybookAlertTab(
  tab: PlaybookAlertTab,
  status: PlaybookAlertStatus | "all",
): readonly PlaybookAlertStatus[] {
  const tabStatuses =
    tab === "completed" ? PLAYBOOK_COMPLETED_STATUSES : PLAYBOOK_PENDING_STATUSES;
  if (status === "all") return tabStatuses;
  if (tabStatuses.includes(status as never)) return [status];
  return tabStatuses;
}

export function mostCommonRule(
  rows: Array<{ ruleId: string; count: number }>,
): { ruleId: string; count: number } | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.count > best.count ? row : best));
}

export function fillDailyPlaybookAlertSeries(
  rows: Array<{ date: string; created: number; completed: number }>,
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
): Array<{ date: string; created: number; completed: number }> {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const result: Array<{ date: string; created: number; completed: number }> = [];

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    result.push(byDate.get(date) ?? { date, created: 0, completed: 0 });
  }

  return result;
}

export function normalizePlaybookAlertFilters(
  input: PlaybookAlertSearchParams,
  now: Date = new Date(),
): PlaybookAlertFilters {
  const tabRaw = firstSearchParam(input.tab)?.trim() ?? "pending";
  const search = firstSearchParam(input.q)?.trim() ?? "";
  const ruleRaw = firstSearchParam(input.ruleId)?.trim() ?? "all";
  const severityRaw = firstSearchParam(input.severity)?.trim() ?? "all";
  const statusRaw = firstSearchParam(input.status)?.trim() ?? "all";
  const pageRaw = Number.parseInt(firstSearchParam(input.page) ?? "1", 10);
  const pageSizeRaw = Number.parseInt(
    firstSearchParam(input.pageSize) ?? String(PLAYBOOK_ALERT_DEFAULT_PAGE_SIZE),
    10,
  );
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = PLAYBOOK_ALERT_PAGE_SIZE_OPTIONS.includes(
    pageSizeRaw as (typeof PLAYBOOK_ALERT_PAGE_SIZE_OPTIONS)[number],
  )
    ? pageSizeRaw
    : PLAYBOOK_ALERT_DEFAULT_PAGE_SIZE;

  return {
    tab: isPlaybookAlertTab(tabRaw) ? tabRaw : "pending",
    window: resolveDashboardDateWindow(input, now),
    search,
    ruleId: isPlaybookAlertRuleId(ruleRaw) ? ruleRaw : "all",
    severity: isPlaybookAlertSeverity(severityRaw) ? severityRaw : "all",
    status: isPlaybookAlertStatus(statusRaw) ? statusRaw : "all",
    page,
    pageSize,
  };
}

export function buildPlaybookAlertHref(filters: PlaybookAlertFilters): string {
  const params = new URLSearchParams();
  if (filters.tab !== "pending") params.set("tab", filters.tab);
  params.set("range", filters.window.preset);
  params.set("from", filters.window.fromDate);
  params.set("to", filters.window.throughDate);
  if (filters.search) params.set("q", filters.search);
  if (filters.ruleId !== "all") params.set("ruleId", filters.ruleId);
  if (filters.severity !== "all") params.set("severity", filters.severity);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.pageSize !== PLAYBOOK_ALERT_DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(filters.pageSize));
  }
  const query = params.toString();
  return query ? `/alerts?${query}` : "/alerts";
}

export function playbookAlertHrefWith(
  filters: PlaybookAlertFilters,
  patch: Partial<{
    tab: PlaybookAlertTab;
    page: number;
    search: string;
    ruleId: PlaybookAlertFilters["ruleId"];
    severity: PlaybookAlertFilters["severity"];
    status: PlaybookAlertFilters["status"];
  }>,
): string {
  return buildPlaybookAlertHref({
    ...filters,
    ...patch,
    page: patch.page ?? (patch.tab && patch.tab !== filters.tab ? 1 : filters.page),
  });
}
