import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getAffiliateById,
  getAffiliateMetrics,
  getAffiliateConversions,
} from "@/lib/affiliate/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const aff = await getAffiliateById(id);
    if (!aff) {
      return NextResponse.json(
        { error: "Affiliate not found" },
        { status: 404 },
      );
    }

    const [metrics, conversions] = await Promise.all([
      getAffiliateMetrics(id),
      getAffiliateConversions(id),
    ]);

    return NextResponse.json({ affiliate: aff, metrics, conversions });
  } catch (error) {
    console.error("Error fetching affiliate:", error);
    return NextResponse.json(
      { error: "Failed to fetch affiliate" },
      { status: 500 },
    );
  }
}
