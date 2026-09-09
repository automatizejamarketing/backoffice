import { callMeta } from "@/lib/meta-business/insights/client";
import { isSameAccount } from "@/lib/meta-business/account-match";

export type AudienceStatus = { code?: number; description?: string };
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
export type AudienceCapability = "available" | "unknown";
export type AudienceCapabilities = {
  read: AudienceCapability;
  include: AudienceCapability;
  exclude: AudienceCapability;
  editMetadata: AudienceCapability;
  editRule: AudienceCapability;
  manageMembers: AudienceCapability;
  delete: AudienceCapability;
  lookalikeSource: AudienceCapability;
};

export type CustomAudienceView = {
  id: string;
  name?: string;
  description?: string;
  subtype?: string;
  approximateCountLowerBound?: number;
  approximateCountUpperBound?: number;
  operationStatus?: AudienceStatus;
  deliveryStatus?: AudienceStatus;
  retentionDays?: number;
  customerFileSource?: string;
  isValueBased?: boolean;
  timeCreated?: number;
  timeUpdated?: number;
  rule?: unknown;
  lookalikeSpec?: unknown;
  lookalikeAudienceIds?: string[];
  originAudienceId?: string;
  ruleSummary: "external" | "not_applicable" | "not_loaded";
  capabilities: AudienceCapabilities;
};

const LIST_FIELDS = ["id", "name", "subtype", "approximate_count_lower_bound", "approximate_count_upper_bound", "operation_status", "delivery_status", "retention_days", "customer_file_source", "is_value_based", "time_created", "time_updated"] as const;
const DETAIL_FIELDS = [...LIST_FIELDS, "description", "rule", "lookalike_spec", "lookalike_audience_ids", "origin_audience_id"] as const;
type RawAudience = Record<string, unknown>;
const num = (value: unknown) => typeof value === "number" ? value : undefined;
const str = (value: unknown) => typeof value === "string" ? value : undefined;

function mapAudience(audience: RawAudience, ruleWasRequested: boolean): CustomAudienceView {
  return {
    id: String(audience.id), name: str(audience.name), description: str(audience.description), subtype: str(audience.subtype),
    approximateCountLowerBound: num(audience.approximate_count_lower_bound), approximateCountUpperBound: num(audience.approximate_count_upper_bound),
    operationStatus: audience.operation_status as AudienceStatus | undefined, deliveryStatus: audience.delivery_status as AudienceStatus | undefined,
    retentionDays: num(audience.retention_days), customerFileSource: str(audience.customer_file_source),
    isValueBased: typeof audience.is_value_based === "boolean" ? audience.is_value_based : undefined,
    timeCreated: num(audience.time_created), timeUpdated: num(audience.time_updated), rule: audience.rule, lookalikeSpec: audience.lookalike_spec,
    lookalikeAudienceIds: Array.isArray(audience.lookalike_audience_ids) ? audience.lookalike_audience_ids as string[] : undefined,
    originAudienceId: str(audience.origin_audience_id), ruleSummary: !ruleWasRequested ? "not_loaded" : audience.rule == null ? "not_applicable" : "external",
    capabilities: { read: "available", include: "unknown", exclude: "unknown", editMetadata: "unknown", editRule: "unknown", manageMembers: "unknown", delete: "unknown", lookalikeSource: "unknown" },
  };
}

export async function listCustomAudiences(args: { adAccountId: string; accessToken: string; detailed?: boolean; after?: string }) {
  const accountId = args.adAccountId.startsWith("act_") ? args.adAccountId : `act_${args.adAccountId}`;
  const fields = args.detailed ? DETAIL_FIELDS : LIST_FIELDS;
  const parameters = [`fields=${fields.join(",")}`, "limit=200"];
  if (args.after) parameters.push(`after=${args.after}`);
  const response = await callMeta<{ data?: RawAudience[]; paging?: { next?: string; cursors?: { after?: string } } }>({ method: "GET", path: `${accountId}/customaudiences`, params: parameters.join("&"), accessToken: args.accessToken }, { retryOnRateLimit: true });
  const nextCursor = response.paging?.cursors?.after;
  return { items: (response.data ?? []).map((audience) => mapAudience(audience, Boolean(args.detailed))), truncated: Boolean(response.paging?.next), ...(nextCursor ? { nextCursor } : {}) };
}
