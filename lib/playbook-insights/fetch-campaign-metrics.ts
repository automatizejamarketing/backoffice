import { metaApiCall } from "@/lib/meta-business/api";
import type { CampaignMetricsRow } from "./types";

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function parseNumber(value: string | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

function parseRoas(
  purchaseRoas: Array<{ value?: string }> | undefined,
): number | null {
  const value = purchaseRoas?.[0]?.value;
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function purchaseCountFromActions(
  actions: Array<{ action_type?: string; value?: string }> | undefined,
): number {
  if (!actions?.length) return 0;
  const purchase = actions.find(
    (action) =>
      action.action_type === "purchase" ||
      action.action_type === "omni_purchase",
  );
  return parseNumber(purchase?.value);
}

function purchaseValueFromActions(
  actionValues: Array<{ action_type?: string; value?: string }> | undefined,
): number {
  if (!actionValues?.length) return 0;
  const purchase = actionValues.find(
    (action) =>
      action.action_type === "purchase" ||
      action.action_type === "omni_purchase",
  );
  return parseNumber(purchase?.value);
}

/**
 * Fetch campaign-level last_30d insights for playbook evaluation.
 */
export async function fetchCampaignMetricsForAccount(args: {
  accessToken: string;
  accountId: string;
  limit?: number;
}): Promise<CampaignMetricsRow[]> {
  const accountId = formatAccountId(args.accountId);
  const limit = Math.min(args.limit ?? 40, 50);

  const response = await metaApiCall<{
    data: Array<{
      id: string;
      name?: string;
      status?: string;
      effective_status?: string;
      updated_time?: string;
      insights?: {
        data?: Array<{
          spend?: string;
          impressions?: string;
          purchase_roas?: Array<{ value?: string }>;
          actions?: Array<{ action_type?: string; value?: string }>;
          action_values?: Array<{ action_type?: string; value?: string }>;
        }>;
      };
    }>;
  }>({
    method: "GET",
    path: `${accountId}/campaigns`,
    params: [
      "fields=id,name,status,effective_status,updated_time,insights.date_preset(last_30d){spend,impressions,purchase_roas,actions,action_values}",
      `limit=${limit}`,
      `effective_status=${encodeURIComponent(
        JSON.stringify([
          "ACTIVE",
          "PAUSED",
          "COMPLETED",
          "ARCHIVED",
          "CAMPAIGN_PAUSED",
        ]),
      )}`,
    ].join("&"),
    accessToken: args.accessToken,
  });

  return response.data.map((campaign) => {
    const insight = campaign.insights?.data?.[0];
    const spend = parseNumber(insight?.spend);
    const purchases = purchaseCountFromActions(insight?.actions);
    let purchaseValue = purchaseValueFromActions(insight?.action_values);
    const purchaseRoas = parseRoas(insight?.purchase_roas);

    if (purchaseValue <= 0 && spend > 0 && purchaseRoas !== null) {
      purchaseValue = purchaseRoas * spend;
    }

    const cpa = purchases > 0 ? spend / purchases : null;

    return {
      id: campaign.id,
      name: campaign.name ?? campaign.id,
      status: campaign.status ?? null,
      effectiveStatus: campaign.effective_status ?? null,
      updatedTime: campaign.updated_time ?? null,
      spend,
      purchaseRoas:
        purchaseRoas ?? (spend > 0 ? purchaseValue / spend : null),
      purchases,
      purchaseValue,
      impressions: parseNumber(insight?.impressions),
      cpa,
    };
  });
}
