import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listProductPixFraudCases } from "@/lib/db/product-queries";

/** The operator can inspect confirmed facts; no action is performed here. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json({ cases: await listProductPixFraudCases() });
}
