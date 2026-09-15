import {
  isCrmAccountStage,
  isCrmCommercialStatus,
  parseCrmDateCondition,
  type CrmAccountStage,
  type CrmCommercialStatus,
  type CrmDateCondition,
} from "./crm";

export const CRM_FILTERS_STORAGE_KEY = "automatize-backoffice.crm-filters.v1";

export type CrmView = "kanban" | "list";

/** Filtros do CRM que sobrevivem a recarregar a página (a busca não entra). */
export type CrmStoredFilters = {
  view: CrmView;
  accountStage?: CrmAccountStage;
  commercialStatus?: CrmCommercialStatus;
  signup?: CrmDateCondition;
  expires?: CrmDateCondition;
};

export const DEFAULT_CRM_FILTERS: CrmStoredFilters = { view: "kanban" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


/** Qualquer campo inválido volta ao padrão; JSON quebrado volta tudo. */
export function parseCrmStoredFilters(
  raw: string | null | undefined,
): CrmStoredFilters {
  if (!raw) return DEFAULT_CRM_FILTERS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return DEFAULT_CRM_FILTERS;
    return {
      view: parsed.view === "list" ? "list" : "kanban",
      accountStage: isCrmAccountStage(parsed.accountStage)
        ? parsed.accountStage
        : undefined,
      commercialStatus: isCrmCommercialStatus(parsed.commercialStatus)
        ? parsed.commercialStatus
        : undefined,
      signup: parseCrmDateCondition(parsed.signup),
      expires: parseCrmDateCondition(parsed.expires),
    };
  } catch {
    return DEFAULT_CRM_FILTERS;
  }
}

export function serializeCrmStoredFilters(filters: CrmStoredFilters): string {
  return JSON.stringify({
    view: filters.view,
    accountStage: filters.accountStage,
    commercialStatus: filters.commercialStatus,
    signup: filters.signup,
    expires: filters.expires,
  });
}
