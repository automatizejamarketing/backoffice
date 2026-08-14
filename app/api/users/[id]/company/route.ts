import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getPrimaryCompanyForUser } from "@/lib/db/admin-queries";

export type CompanyResponse = {
  company: {
    id: string;
    name: string;
    niche: string | null;
    websiteUrl: string | null;
    businessOperatingHours: unknown;
    businessAddress: unknown;
  } | null;
};

/**
 * GET /api/users/[id]/company
 *
 * Primary company for the AI campaign flow.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<CompanyResponse | { error: string }>> {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const company = await getPrimaryCompanyForUser(id);
  if (!company) {
    return NextResponse.json({ company: null });
  }

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      niche: company.niche,
      websiteUrl: company.websiteUrl,
      businessOperatingHours: company.businessOperatingHours,
      businessAddress: company.businessAddress,
    },
  });
}
