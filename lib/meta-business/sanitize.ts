import type { MetaBusinessAccount } from "@/lib/db/schema";

export type SanitizedMetaBusinessAccount = Omit<
  MetaBusinessAccount,
  "accessToken"
>;

export function sanitizeMetaBusinessAccount(
  account: MetaBusinessAccount | null,
): SanitizedMetaBusinessAccount | null {
  if (!account) return null;
  return {
    id: account.id,
    userId: account.userId,
    facebookUserId: account.facebookUserId,
    name: account.name,
    pictureUrl: account.pictureUrl,
    tokenExpiresAt: account.tokenExpiresAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    deletedAt: account.deletedAt,
  };
}
