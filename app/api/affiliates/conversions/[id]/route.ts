import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { updateConversionStatus } from "@/lib/affiliate/queries";
import type { AffiliateConversionStatus } from "@/lib/db/schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status } = body as { status: AffiliateConversionStatus };

    if (!status || !["pending", "approved", "paid", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 },
      );
    }

    await updateConversionStatus(id, status);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating conversion:", error);
    return NextResponse.json(
      { error: "Failed to update conversion" },
      { status: 500 },
    );
  }
}
