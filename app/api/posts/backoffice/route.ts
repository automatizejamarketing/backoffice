import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackofficeGeneratedPosts } from "@/lib/db/admin-queries";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);

  try {
    const result = await getBackofficeGeneratedPosts({ page, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching backoffice posts:", error);
    return NextResponse.json(
      { error: "Failed to fetch backoffice posts" },
      { status: 500 }
    );
  }
}
