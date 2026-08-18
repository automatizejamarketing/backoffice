import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { adCreative } from "@/lib/db/schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  try {
    const { id } = await params;
    const body = await request.json();

    if (typeof body.isPublished !== "boolean") {
      return NextResponse.json(
        { error: "Invalid isPublished value" },
        { status: 400 },
      );
    }

    await db
      .update(adCreative)
      .set({
        isPublished: body.isPublished,
        updatedAt: new Date(),
      })
      .where(eq(adCreative.id, id));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error updating ad creative:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
