import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { upsertCampaignPerformanceSnapshot } from "@/lib/db/business-queries";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { transformInsights } from "@/lib/meta-business/marketing/insights";
import { AM_CAMPAIGN_PREFIX } from "@/lib/marketing/performance-rules";
import type { GraphApiInsights } from "@/lib/meta-business/types";

// On-demand counterpart of the frontend weekly cron
// (automatize-frontend/app/api/cron-job/marketing/refresh-campaign-performance).
// Lets an admin pull a single user's [AM] campaign performance immediately
// instead of waiting for Sunday. Uses a rolling last-7-days window (ending
// yesterday) so the data is fresh at click time.

const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const DAY_MS = 24 * 60 * 60 * 1000;

type AccountCampaignInsightRow = GraphApiInsights & {
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
};

type InsightsPage = {
  data: AccountCampaignInsightRow[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

export type CampaignPerformanceRefreshResult = {
  checkedAccounts: number;
  campaignsSaved: number;
  periodStart: string;
  periodEnd: string;
  errorMessage: string | null;
};

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function businessDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toNumber(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchAccountCampaignInsights(args: {
  accessToken: string;
  accountId: string;
  since: string;
  until: string;
}): Promise<AccountCampaignInsightRow[]> {
  const rows: AccountCampaignInsightRow[] = [];
  let after: string | undefined;

  do {
    const params = [
      "level=campaign",
      `time_range=${encodeURIComponent(
        JSON.stringify({ since: args.since, until: args.until }),
      )}`,
      "fields=campaign_id,campaign_name,objective,spend,impressions,clicks,actions,action_values,purchase_roas,website_purchase_roas",
      "limit=200",
    ];
    if (after) params.push(`after=${after}`);

    const page = await metaApiCall<InsightsPage>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formatAccountId(args.accountId)}/insights`,
      params: params.join("&"),
      accessToken: args.accessToken,
    });

    rows.push(...page.data);
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
  } while (after);

  return rows;
}

export async function refreshCampaignPerformanceForUser(
  userId: string,
): Promise<CampaignPerformanceRefreshResult> {
  const now = new Date();
  // Rolling last 7 days ending yesterday (business timezone).
  const periodEnd = businessDateKey(new Date(now.getTime() - DAY_MS));
  const periodStart = businessDateKey(new Date(now.getTime() - 7 * DAY_MS));

  const metaAccount = await getUserMetaBusinessAccount(userId);
  if (!metaAccount) {
    return {
      checkedAccounts: 0,
      campaignsSaved: 0,
      periodStart,
      periodEnd,
      errorMessage: "Cliente sem conta Meta conectada.",
    };
  }

  try {
    const userWithAdAccounts = await getUserWithAdAccounts(
      metaAccount.accessToken,
    );
    const adAccounts = userWithAdAccounts.adaccounts?.data ?? [];
    let campaignsSaved = 0;
    let firstError: string | null = null;

    for (const account of adAccounts) {
      try {
        const rows = await fetchAccountCampaignInsights({
          accessToken: metaAccount.accessToken,
          accountId: account.id,
          since: periodStart,
          until: periodEnd,
        });

        for (const row of rows) {
          const name = row.campaign_name?.trim();
          if (!name || !name.startsWith(AM_CAMPAIGN_PREFIX)) continue;
          if (!row.campaign_id) continue;

          const insights = transformInsights({ data: [row] });
          const spend = toNumber(insights?.spend);
          const revenue = toNumber(insights?.purchaseValue);
          const roas = toNumber(insights?.purchaseRoas);
          const purchaseCount = Math.round(toNumber(insights?.purchaseCount));
          const impressions = Math.round(toNumber(insights?.impressions));
          const clicks = Math.round(toNumber(insights?.clicks));

          await upsertCampaignPerformanceSnapshot({
            userId,
            adAccountId: account.id,
            adAccountName: account.name ?? null,
            campaignId: row.campaign_id,
            campaignName: name,
            objective: row.objective ?? null,
            spend,
            revenue,
            purchaseRoas: roas,
            purchaseCount,
            impressions,
            clicks,
            currency: account.currency ?? null,
            metrics: { roas, revenue, spend, purchaseCount, impressions, clicks },
            periodStart,
            periodEnd,
          });
          campaignsSaved += 1;
        }
      } catch (error) {
        firstError =
          firstError ??
          (error instanceof Error
            ? error.message
            : "Erro ao buscar performance na Meta.");
      }
    }

    return {
      checkedAccounts: adAccounts.length,
      campaignsSaved,
      periodStart,
      periodEnd,
      errorMessage: firstError,
    };
  } catch (error) {
    return {
      checkedAccounts: 0,
      campaignsSaved: 0,
      periodStart,
      periodEnd,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Erro ao buscar contas de anúncio na Meta.",
    };
  }
}
