import { clampDatePreset } from "./filters";

export function getBackofficeBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "https://backoffice.automatizemarketing.com"
  ).replace(/\/+$/, "");
}

export function buildPerformanceReportUrl(input: {
  userId: string;
  view?: "report" | "marketing";
  accountId?: string;
  campaignId?: string;
  datePreset?: string;
  since?: string;
  until?: string;
}): string {
  const params = new URLSearchParams({ tab: "marketing" });
  if (input.view === "report" || !input.campaignId) {
    params.set("view", "report");
  }
  if (input.accountId) params.set("accountId", input.accountId);
  if (input.campaignId) params.set("campaignId", input.campaignId);
  if (input.since && input.until) {
    params.set("since", input.since);
    params.set("until", input.until);
  } else {
    params.set("datePreset", clampDatePreset(input.datePreset));
  }
  return `${getBackofficeBaseUrl()}/users/${input.userId}?${params.toString()}`;
}

export function buildCampaignWorkspaceUrl(input: {
  userId: string;
  accountId: string;
  campaignId: string;
  datePreset?: string;
  since?: string;
  until?: string;
}): string {
  const params = new URLSearchParams({
    tab: "marketing",
    accountId: input.accountId,
    campaignId: input.campaignId,
  });
  if (input.since && input.until) {
    params.set("since", input.since);
    params.set("until", input.until);
  } else {
    params.set("datePreset", clampDatePreset(input.datePreset));
  }
  return `/users/${input.userId}?${params.toString()}`;
}
