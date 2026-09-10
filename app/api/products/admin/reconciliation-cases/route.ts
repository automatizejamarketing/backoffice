import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  listProductPaymentAttempts,
  listProductReconciliationCases,
} from "@/lib/db/product-queries";

/** Reading the queue only exposes recorded evidence; it settles nothing. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const [cases, attempts] = await Promise.all([
    listProductReconciliationCases(),
    listProductPaymentAttempts(),
  ]);
  return NextResponse.json({ cases, attempts });
}
