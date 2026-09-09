import { callMeta } from "@/lib/meta-business/insights/client";
import type { SanitizedCustomerFileHistory } from "@/lib/customer-file/sanitize";
import { isSameAccount } from "@/lib/meta-business/account-match";
import { compromisesAudienceImport } from "./integrity";
import type {
  AudienceImportResult,
  AudienceMetaProcessingState,
  AudienceStatus,
  CustomAudienceView,
} from "./types";

export type {
  AudienceCapabilities,
  AudienceCapability,
  AudienceAvailability,
  AudienceFunctionAvailability,
  AudienceImportResult,
  AudienceMetaProcessingState,
  AudienceStatus,
  CustomAudienceView,
} from "./types";
export class AccountNotAccessibleError extends Error {
  readonly adAccountId: string;

  constructor(adAccountId: string) {
    super("A conta de an\u00fancios selecionada n\u00e3o est\u00e1 acess\u00edvel nesta conex\u00e3o.");
    this.name = "AccountNotAccessibleError";
    this.adAccountId = adAccountId;
  }
}

export function assertCustomAudienceAccountAccess(
  adAccountId: string,
  accessibleAccounts: ReadonlyArray<{ id: string; account_id: string }>,
): void {
  if (!accessibleAccounts.some((account) => isSameAccount(account.id, adAccountId) || isSameAccount(account.account_id, adAccountId))) {
    throw new AccountNotAccessibleError(adAccountId);
  }
}
const LIST_FIELDS = ["id", "name", "subtype", "approximate_count_lower_bound", "approximate_count_upper_bound", "operation_status", "delivery_status", "retention_days", "customer_file_source", "permission_for_actions", "is_value_based", "time_created", "time_updated"] as const;
const DETAIL_FIELDS = [...LIST_FIELDS, "description", "rule", "lookalike_spec", "lookalike_audience_ids", "origin_audience_id"] as const;
type RawAudience = Record<string, unknown>;
const num = (value: unknown) => typeof value === "number" ? value : undefined;
const str = (value: unknown) => typeof value === "string" ? value : undefined;
const capability = (value: unknown): "available" | "unavailable" | "unknown" => value === true ? "available" : value === false ? "unavailable" : "unknown";

function mapAudience(
  audience: RawAudience,
  ruleWasRequested: boolean,
  importHistory?: ReadonlyMap<string, SanitizedCustomerFileHistory>,
): CustomAudienceView {
  const permissions = typeof audience.permission_for_actions === "object" && audience.permission_for_actions !== null
    ? audience.permission_for_actions as Record<string, unknown>
    : undefined;
  const mapped: CustomAudienceView = {
    id: String(audience.id), name: str(audience.name), description: str(audience.description), subtype: str(audience.subtype),
    approximateCountLowerBound: num(audience.approximate_count_lower_bound), approximateCountUpperBound: num(audience.approximate_count_upper_bound),
    operationStatus: audience.operation_status as AudienceStatus | undefined, deliveryStatus: audience.delivery_status as AudienceStatus | undefined,
    retentionDays: num(audience.retention_days), customerFileSource: str(audience.customer_file_source),
    isValueBased: typeof audience.is_value_based === "boolean" ? audience.is_value_based : undefined,
    timeCreated: num(audience.time_created), timeUpdated: num(audience.time_updated), rule: audience.rule, lookalikeSpec: audience.lookalike_spec,
    lookalikeAudienceIds: Array.isArray(audience.lookalike_audience_ids) ? audience.lookalike_audience_ids as string[] : undefined,
    originAudienceId: str(audience.origin_audience_id), ruleSummary: !ruleWasRequested ? "not_loaded" : audience.rule == null ? "not_applicable" : "external",
    // Meta exposes one `can_edit` permission for the audience object; it authorizes both sparse metadata edits and replacing the complete rule.
    capabilities: { read: "available", include: "unknown", exclude: "unknown", editMetadata: capability(permissions?.can_edit), share: capability(permissions?.can_share), editRule: capability(permissions?.can_edit), manageMembers: "unknown", delete: "unknown", lookalikeSource: capability(permissions?.supports_recipient_lookalike ?? permissions?.subtype_supports_lookalike) },
  };

  if (importHistory !== undefined) {
    const history = importHistory.get(mapped.id);
    const importState = history?.state ?? "not_recorded";
    const importResult = history ? importResultOf(history) : undefined;
    const compromised = compromisesAudienceImport(importState, importResult);
    const sourceSupportsLookalike = Boolean(
      mapped.customerFileSource ||
        mapped.subtype === "ENGAGEMENT" ||
        mapped.subtype === "WEBSITE",
    );
    mapped.importState = importState;
    mapped.importResult = importResult ?? { known: false, state: "not_recorded" };
    mapped.availability = {
      include: compromised ? "blocked" : "available",
      exclude: compromised ? "blocked" : "available",
      lookalikeSource: !sourceSupportsLookalike
        ? "unknown"
        : compromised
          ? "blocked"
          : "available",
      metaProcessing: metaProcessingState(mapped.operationStatus),
    };
  }

  return mapped;
}

function importResultOf(history: SanitizedCustomerFileHistory): AudienceImportResult {
  return {
    known: true,
    state: history.state,
    operation: history.operation,
    pendingUnresolved: history.pendingUnresolved,
    receivedAt: history.receivedAt.toISOString(),
    updatedAt: history.updatedAt.toISOString(),
    confirmedBatches: history.confirmedBatches.length,
    confirmedRecords: history.receipts.reduce(
      (total, receipt) => total + Math.max(0, (receipt.received ?? 0) - (receipt.rejected ?? 0)),
      0,
    ) || Math.max(0, history.counts.confirmed ?? 0),
    rejectedRecords: history.receipts.reduce(
      (total, receipt) => total + Math.max(0, receipt.rejected ?? 0),
      0,
    ) || Math.max(0, history.counts.rejected ?? 0),
  };
}

function metaProcessingState(status: AudienceStatus | undefined): AudienceMetaProcessingState {
  if (!status) return "unknown";
  if (status.code === 200) return "ready";
  if (
    status.code === 441 ||
    /process|preench|upload|aguard/i.test(status.description ?? "")
  ) {
    return "processing";
  }
  return "unknown";
}

export async function listCustomAudiences(args: { adAccountId: string; accessToken: string; detailed?: boolean; after?: string; importHistory?: ReadonlyMap<string, SanitizedCustomerFileHistory> }) {
  const accountId = args.adAccountId.startsWith("act_") ? args.adAccountId : `act_${args.adAccountId}`;
  const fields = args.detailed ? DETAIL_FIELDS : LIST_FIELDS;
  const parameters = [`fields=${fields.join(",")}`, "limit=200"];
  if (args.after) parameters.push(`after=${args.after}`);
  const response = await callMeta<{ data?: RawAudience[]; paging?: { next?: string; cursors?: { after?: string } } }>({ method: "GET", path: `${accountId}/customaudiences`, params: parameters.join("&"), accessToken: args.accessToken }, { retryOnRateLimit: true });
  const nextCursor = response.paging?.cursors?.after;
  return { items: (response.data ?? []).map((audience) => mapAudience(audience, Boolean(args.detailed), args.importHistory)), truncated: Boolean(response.paging?.next), ...(nextCursor ? { nextCursor } : {}) };
}

export async function getCustomAudienceDetail(args: {
  audienceId: string;
  accessToken: string;
  importHistory?: ReadonlyMap<string, SanitizedCustomerFileHistory>;
}): Promise<CustomAudienceView> {
  const response = await callMeta<RawAudience>(
    {
      method: "GET",
      path: args.audienceId,
      params: `fields=${DETAIL_FIELDS.join(",")}`,
      accessToken: args.accessToken,
    },
    { retryOnRateLimit: true },
  );
  return mapAudience(response, true, args.importHistory);
}
