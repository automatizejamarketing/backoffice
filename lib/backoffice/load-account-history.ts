"use server";

import { requireBackofficePermission } from "@/lib/auth/rbac";
import type { SerializedAccountHistoryItem } from "@/lib/backoffice/account-history";
import { getUserAccountHistory } from "@/lib/db/admin-queries";

export async function loadUserAccountHistory(
  userId: string,
): Promise<SerializedAccountHistoryItem[]> {
  await requireBackofficePermission("users:manage");
  return getUserAccountHistory(userId);
}
