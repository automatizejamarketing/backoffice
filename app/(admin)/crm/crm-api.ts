import type {
  CrmAccountStage,
  CrmCommercialStatus,
  CrmDateRange,
  CrmKanbanColumn,
  CrmLeadEventView,
  CrmLeadSummary,
} from "@/lib/backoffice/crm";

export type CrmListResponse = {
  leads: CrmLeadSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type CrmKanbanResponse = { columns: CrmKanbanColumn[] };

export type CrmLeadDetailResponse = {
  lead: CrmLeadSummary;
  events: CrmLeadEventView[];
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `Falha na requisição (${response.status})`);
  }
  return (await response.json()) as T;
}

export type CrmDateFilters = {
  signup?: CrmDateRange;
  expires?: CrmDateRange;
};

function applyDateFilters(query: URLSearchParams, params: CrmDateFilters) {
  if (params.signup) {
    query.set("signupFrom", params.signup.from);
    query.set("signupTo", params.signup.to);
  }
  if (params.expires) {
    query.set("expiresFrom", params.expires.from);
    query.set("expiresTo", params.expires.to);
  }
}

export function fetchCrmKanban(params: CrmDateFilters & {
  search: string;
  accountStage?: CrmAccountStage;
}) {
  const query = new URLSearchParams({ view: "kanban" });
  if (params.search) query.set("q", params.search);
  if (params.accountStage) query.set("accountStage", params.accountStage);
  applyDateFilters(query, params);
  return fetch(`/api/crm/leads?${query}`, { cache: "no-store" }).then((r) =>
    readJson<CrmKanbanResponse>(r),
  );
}

export function fetchCrmList(params: CrmDateFilters & {
  search: string;
  accountStage?: CrmAccountStage;
  commercialStatus?: CrmCommercialStatus;
  page: number;
  pageSize: number;
}) {
  const query = new URLSearchParams({
    view: "list",
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set("q", params.search);
  if (params.accountStage) query.set("accountStage", params.accountStage);
  if (params.commercialStatus) query.set("commercialStatus", params.commercialStatus);
  applyDateFilters(query, params);
  return fetch(`/api/crm/leads?${query}`, { cache: "no-store" }).then((r) =>
    readJson<CrmListResponse>(r),
  );
}

export function fetchCrmLead(userId: string) {
  return fetch(`/api/crm/leads/${userId}`, { cache: "no-store" }).then((r) =>
    readJson<CrmLeadDetailResponse>(r),
  );
}

export function updateCrmLeadStatus(userId: string, status: CrmCommercialStatus) {
  return fetch(`/api/crm/leads/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commercialStatus: status }),
  }).then((r) => readJson<{ changed: boolean; from: CrmCommercialStatus }>(r));
}

export function createCrmLeadNote(userId: string, body: string) {
  return fetch(`/api/crm/leads/${userId}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  }).then((r) => readJson<{ event: CrmLeadEventView }>(r));
}

export function formatRelativeDays(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "há 1 dia";
  return `há ${days} dias`;
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}
