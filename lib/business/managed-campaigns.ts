import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { upsertManagedCampaignCache } from "@/lib/db/business-queries";
import type { BusinessOperatingRules } from "@/lib/business/business-health";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";

type MetaCampaign = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  start_time?: string;
  stop_time?: string;
  adsets?: {
    data?: Array<{
      status?: string;
      effective_status?: string;
      start_time?: string;
      end_time?: string;
    }>;
  };
};

type MetaCampaignsPage = {
  data: MetaCampaign[];
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
};

const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

export type ManagedCampaignRefreshResult = {
  checkedAccounts: number;
  hasActiveManagedCampaign: boolean;
  managedCampaignNames: string[];
  errorMessage: string | null;
};

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function dateIsAfterNow(value: string | undefined, now: Date): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() > now.getTime();
}

function dateStarted(value: string | undefined, now: Date): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= now.getTime();
}

function isActiveStatus(status: string | undefined): boolean {
  return status === "ACTIVE";
}

function businessDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function wasManagedCampaignCheckedToday(
  checkedAt: Date | string | null,
  referenceDate = new Date(),
): boolean {
  if (!checkedAt) return false;
  const checkedDate = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  if (Number.isNaN(checkedDate.getTime())) return false;
  return businessDateKey(checkedDate) === businessDateKey(referenceDate);
}

export function isManagedCampaignRunningNow(
  campaign: Pick<
    MetaCampaign,
    "name" | "status" | "effective_status" | "start_time" | "stop_time" | "adsets"
  >,
  prefix: string,
  now = new Date(),
): boolean {
  const name = campaign.name?.trim();
  if (!name?.startsWith(prefix)) return false;
  if (!isActiveStatus(campaign.status)) return false;
  if (!isActiveStatus(campaign.effective_status)) return false;
  if (!dateStarted(campaign.start_time, now)) return false;
  if (!dateIsAfterNow(campaign.stop_time, now)) return false;

  const adsets = campaign.adsets?.data ?? [];
  if (adsets.length === 0) return true;

  return adsets.some(
    (adset) =>
      isActiveStatus(adset.status) &&
      isActiveStatus(adset.effective_status) &&
      dateStarted(adset.start_time, now) &&
      dateIsAfterNow(adset.end_time, now),
  );
}

async function fetchActiveManagedCampaignNames(args: {
  accessToken: string;
  account: FacebookAdAccountBasicInfo;
  prefix: string;
}): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  let after: string | undefined;

  do {
    const params = [
      "fields=id,name,status,effective_status,start_time,stop_time,adsets.limit(200){id,status,effective_status,start_time,end_time}",
      "limit=100",
      `effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE"]))}`,
    ];
    if (after) params.push(`after=${after}`);

    const page = await metaApiCall<MetaCampaignsPage>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formatAccountId(args.account.id)}/campaigns`,
      params: params.join("&"),
      accessToken: args.accessToken,
    });

    for (const campaign of page.data) {
      const name = campaign.name?.trim();
      if (
        !name ||
        !isManagedCampaignRunningNow(campaign, args.prefix)
      ) {
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }

    after = page.paging?.next ? page.paging.cursors?.after : undefined;
  } while (after && names.length < 100);

  return names;
}

export async function refreshManagedCampaignCacheForUser(
  userId: string,
  rules: Pick<BusinessOperatingRules, "managedCampaignNamePrefix">,
): Promise<ManagedCampaignRefreshResult> {
  const metaAccount = await getUserMetaBusinessAccount(userId);
  if (!metaAccount) {
    return {
      checkedAccounts: 0,
      hasActiveManagedCampaign: false,
      managedCampaignNames: [],
      errorMessage: "Cliente sem conta Meta conectada.",
    };
  }

  try {
    const userWithAdAccounts = await getUserWithAdAccounts(
      metaAccount.accessToken,
    );
    const adAccounts = userWithAdAccounts.adaccounts?.data ?? [];
    const allNames: string[] = [];
    let firstError: string | null = null;

    for (const account of adAccounts) {
      try {
        const names = await fetchActiveManagedCampaignNames({
          accessToken: metaAccount.accessToken,
          account,
          prefix: rules.managedCampaignNamePrefix,
        });
        allNames.push(...names);
        await upsertManagedCampaignCache({
          userId,
          adAccountId: account.id,
          adAccountName: account.name ?? null,
          hasActiveManagedCampaign: names.length > 0,
          managedCampaignNames: names,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao buscar campanhas na Meta.";
        firstError = firstError ?? message;
        await upsertManagedCampaignCache({
          userId,
          adAccountId: account.id,
          adAccountName: account.name ?? null,
          hasActiveManagedCampaign: false,
          managedCampaignNames: [],
          errorMessage: message,
        });
      }
    }

    return {
      checkedAccounts: adAccounts.length,
      hasActiveManagedCampaign: allNames.length > 0,
      managedCampaignNames: Array.from(new Set(allNames)),
      errorMessage: firstError,
    };
  } catch (error) {
    return {
      checkedAccounts: 0,
      hasActiveManagedCampaign: false,
      managedCampaignNames: [],
      errorMessage:
        error instanceof Error
          ? error.message
          : "Erro ao buscar contas de anúncio na Meta.",
    };
  }
}
