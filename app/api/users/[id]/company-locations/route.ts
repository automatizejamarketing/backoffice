import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  getCompanyLocationsByCompanyId,
  getPrimaryCompanyForUser,
} from "@/lib/db/admin-queries";
import type { CompanyLocationsResponse } from "@/lib/db/company-location-queries";
import { parseLocationHours } from "@/lib/meta-business/location-hours";

export type { CompanyLocationsResponse };

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

  const body: CompanyLocationsResponse = {
    company: {
      id: company.id,
      name: company.name,
      niche: company.niche ?? null,
      websiteUrl: company.websiteUrl ?? null,
      googlePlaceId: company.googlePlaceId ?? null,
      businessAddress: company.businessAddress,
    },
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      isPrimary: location.isPrimary,
      googlePlaceId: location.googlePlaceId,
      businessAddress: location.businessAddress,
      businessOperatingHours: parseLocationHours(
        location.businessOperatingHours,
      ),
    })),
  };

  return NextResponse.json(body);
}
