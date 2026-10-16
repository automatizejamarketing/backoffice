type AccessibleAccount = { account_id: string; id?: string };
function canonicalAccountId(value: string): string | null {
  const digits = value.replace(/^act_/i, "");
  return /^\d+$/.test(digits) ? digits : null;
}
export function resolveAudienceAccountId(accounts: AccessibleAccount[], requestedAccountId: string | null): string | null {
  if (requestedAccountId === null) return accounts[0] ? canonicalAccountId(accounts[0].account_id) : null;
  const requested = canonicalAccountId(requestedAccountId);
  if (!requested) return null;
  return accounts.find((account) => canonicalAccountId(account.account_id) === requested) ? requested : null;
}
export function buildAudienceLibraryHref({ userId, accountId, embedded = false }: {
  userId: string; accountId: string | null; embedded?: boolean;
}): string {
  const query = new URLSearchParams({ userId });
  if (accountId) query.set("accountId", accountId);
  return `${embedded ? "/embed" : ""}/marketing/audiences?${query}`;
}
