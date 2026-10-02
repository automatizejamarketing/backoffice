import { NextResponse } from "next/server";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { SafeMetaConnection } from "@/lib/meta-business/connection-record";
/** Validate the target user's grants before reading advertising identities. */
export async function requireMetaAccount(accessToken: string, connection: SafeMetaConnection, accountId: string) {
  const id = accountId.replace(/^act_/, "");
  const accounts = await getUserWithAdAccounts(accessToken, {tokenKind:connection.tokenKind, bisuAppScopedId:connection.bisuAppScopedId, clientBusinessId:connection.clientBusinessId, connectionName:connection.name});
  if (!id || !(accounts.adaccounts?.data ?? []).some(account => (account.account_id || account.id.replace(/^act_/, "")) === id)) {
    return NextResponse.json({error:"account_not_assigned",message:"Esta conta de anúncios não está concedida ao cliente."},{status:403});
  }
  return null;
}
