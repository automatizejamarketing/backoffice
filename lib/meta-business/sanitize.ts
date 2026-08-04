import type { MetaBusinessAccount } from "@/lib/db/schema";

export type SanitizedMetaBusinessAccount = Omit<
  MetaBusinessAccount,
  "accessToken"
>;

export function sanitizeMetaBusinessAccount(
  account: MetaBusinessAccount | null,
): SanitizedMetaBusinessAccount | null {
  if (!account) return null;
  const { accessToken: _accessToken, ...safe } = account;
  return safe;
}
