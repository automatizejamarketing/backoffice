import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { loadMetaAssetsCard } from "@/lib/backoffice/meta-assets-card-data";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";

export type { MetaAssetsResponse };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<MetaAssetsResponse | { error: string }>> {
  const { id: userId } = await params;
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;

  const payload = await loadMetaAssetsCard({
    userId,
    canEdit: hasBackofficePermission(authz.actor, "users:manage"),
  });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
