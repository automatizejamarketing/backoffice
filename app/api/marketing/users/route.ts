import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getUsersWithMetaBusinessAccount } from "@/lib/db/admin-queries";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email") ?? undefined;
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;

  try {
    const result = await getUsersWithMetaBusinessAccount({
      email,
      page,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching marketing users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 },
    );
  }
}
