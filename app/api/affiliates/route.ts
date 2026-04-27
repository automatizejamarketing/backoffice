import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getAllAffiliates } from "@/lib/affiliate/queries";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const limit = Math.min(
      Number.parseInt(searchParams.get("limit") || "50"),
      100,
    );
    const offset = Number.parseInt(searchParams.get("offset") || "0");

    const affiliates = await getAllAffiliates(
      status ? { status } : undefined,
      limit,
      offset,
    );

    return NextResponse.json({
      affiliates,
      pagination: { limit, offset, hasMore: affiliates.length === limit },
    });
  } catch (error) {
    console.error("Error fetching affiliates:", error);
    return NextResponse.json(
      { error: "Failed to fetch affiliates" },
      { status: 500 },
    );
  }
}
