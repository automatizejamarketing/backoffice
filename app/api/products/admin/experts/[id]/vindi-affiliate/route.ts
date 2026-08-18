import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { ensureExpertVindiAffiliate } from "@/lib/backoffice/vindi-affiliate";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  try {
    return NextResponse.json(
      await ensureExpertVindiAffiliate({
        expertId: id,
        adminEmail: authz.actor.email,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}
