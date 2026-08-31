import { type NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { listLikelyContributorDiagnosesForAccount } from "@/lib/db/creative-analysis-queries";
import type { AdCreativeDiagnosisMini } from "@/lib/creative-analysis/playground";

export const dynamic = "force-dynamic";

type CreativeDiagnosesResponse = {
  diagnoses: AdCreativeDiagnosisMini[];
};

type CreativeDiagnosesErrorResponse = {
  error: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<CreativeDiagnosesResponse | CreativeDiagnosesErrorResponse>
> {
  const userId = request.nextUrl.searchParams.get("userId");
  const authz = await requireMarketingUserAccessResponse(
    userId,
    "marketing:read",
  );
  if (!authz.ok) return authz.response;

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
  }

  try {
    const diagnoses = await listLikelyContributorDiagnosesForAccount({
      userId: userId as string,
      accountId,
    });
    return NextResponse.json(
      { diagnoses },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[creative-diagnoses] failed to list mini diagnoses", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as análises de criativo." },
      { status: 500 },
    );
  }
}
