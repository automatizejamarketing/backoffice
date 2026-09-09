import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listProductDisputeDefences } from "@/lib/db/product-queries";

/** Reading a defence only exposes audit data; it never submits a case. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json({ defences: await listProductDisputeDefences() });
}
