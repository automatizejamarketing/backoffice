import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listProductReconciliationCases } from "@/lib/db/product-queries";

/** Reading the queue only exposes recorded evidence; it settles nothing. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json({ cases: await listProductReconciliationCases() });
}
