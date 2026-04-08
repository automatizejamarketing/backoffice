import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getAffiliateById,
  updateAffiliateCode,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { code } = body as { code: string };

    if (!code?.trim()) {
      return NextResponse.json(
        { error: "Missing code" },
        { status: 400 },
      );
    }

    const aff = await getAffiliateById(id);
    if (!aff) {
      return NextResponse.json(
        { error: "Affiliate not found" },
        { status: 404 },
      );
    }

    if (aff.status !== "pending") {
      return NextResponse.json(
        { error: "Can only edit code for pending affiliates" },
        { status: 409 },
      );
    }

    const newCode = code.trim();
    const oldCode = aff.code;

    if (newCode === oldCode) {
      return NextResponse.json({ success: true });
    }

    await updateAffiliateCode(id, newCode);
    await createAffiliateActionLog(id, session.user.email, "code_edited", {
      old_code: oldCode,
      new_code: newCode,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating affiliate code:", error);
    return NextResponse.json(
      { error: "Failed to update affiliate code" },
      { status: 500 },
    );
  }
}
