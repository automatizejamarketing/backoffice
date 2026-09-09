import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listProductRefundRequests } from "@/lib/db/product-queries";

/** Read-only queue: a request must never trigger the financial refund endpoint. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json({ requests: await listProductRefundRequests() });
}
