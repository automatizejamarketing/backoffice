import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  getCompanyLocationsByCompanyId,
  getPrimaryCompanyForUser,
} from "@/lib/db/admin-queries";

export type CompanyLocationsResponse = {
  company: {
    id: string;
    name: string;
    niche: string | null;
    websiteUrl: string | null;
  } | null;
  locations: Array<{
    id: string;
    name: string | null;
    isPrimary: boolean;
    businessOperatingHours: unknown;
    businessAddress: unknown;
  }>;
};

/**
 * GET /api/users/[id]/company-locations
 *
 * Customer's primary company + its locations for the AI campaign flow.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<CompanyLocationsResponse | { error: string }>> {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const company = await getPrimaryCompanyForUser(id);
  if (!company) {
    return NextResponse.json({ company: null, locations: [] });
  }

  const locations = await getCompanyLocationsByCompanyId(company.id);

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      niche: company.niche ?? null,
      websiteUrl: company.websiteUrl ?? null,
    },
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      isPrimary: location.isPrimary,
      businessOperatingHours: location.businessOperatingHours,
      businessAddress: location.businessAddress,
    })),
  });
}
