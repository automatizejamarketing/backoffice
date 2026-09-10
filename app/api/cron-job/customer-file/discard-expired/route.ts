import { NextResponse, type NextRequest } from "next/server";

import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { customerFileDurableStore } from "@/lib/customer-file/postgres";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[customer-file-discard]");
  if (!auth.ok) return auth.response;

  const executedAt = new Date();
  const discarded = await customerFileDurableStore().discardExpiredTemporary(executedAt);
  return NextResponse.json({
    executed_at: executedAt.toISOString(),
    discarded,
  });
}
