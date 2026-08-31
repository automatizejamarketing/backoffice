import { DatePreset } from "@/lib/meta-business/types";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";

export type MarketingDeepLink = {
  view: string | null;
  accountId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  datePreset: DatePreset | null;
  since: string | null;
  until: string | null;
};

const DATE_PRESET_VALUES = new Set<string>(Object.values(DatePreset));

export function parseMarketingDeepLink(
  searchParams: { get: (key: string) => string | null },
): MarketingDeepLink {
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const rawPreset = searchParams.get("datePreset");
  const datePreset =
    rawPreset && DATE_PRESET_VALUES.has(rawPreset)
      ? (rawPreset as DatePreset)
      : null;
  return {
    view: searchParams.get("view"),
    accountId: searchParams.get("accountId"),
    campaignId: searchParams.get("campaignId"),
    adsetId: searchParams.get("adsetId"),
    adId: searchParams.get("adId"),
    datePreset,
    since: since && until ? since : null,
    until: since && until ? until : null,
  };
}

export function accountDigits(accountId: string): string {
  return accountId.replace(/^act_/i, "");
}

export function matchAdAccountId(
  accounts: FacebookAdAccountBasicInfo[],
  wanted: string | null,
): string | null {
  if (!wanted) return null;
  const digits = accountDigits(wanted);
  const match = accounts.find(
    (account) =>
      account.account_id === digits ||
      account.account_id === wanted ||
      account.id === wanted ||
      accountDigits(account.id) === digits,
  );
  return match?.account_id ?? null;
}

export function buildMarketingAdHref(input: {
  userId: string;
  userEmail?: string | null;
  accountId: string;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("userId", input.userId);
  if (input.userEmail) params.set("email", input.userEmail);
  params.set("accountId", accountDigits(input.accountId));
  if (input.campaignId) params.set("campaignId", input.campaignId);
  if (input.adsetId) params.set("adsetId", input.adsetId);
  if (input.adId) params.set("adId", input.adId);
  return `/marketing?${params.toString()}`;
}
