import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { updateUserExpirationWithAudit } from "@/lib/backoffice/user-field-updates";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;
    const body = await request.json();
    const { expirationDate } = body as { expirationDate: string };

    if (!expirationDate) {
      return NextResponse.json(
        { error: "expirationDate is required" },
        { status: 400 }
      );
    }

    const result = await updateUserExpirationWithAudit({
      userId,
      expirationDateInput: expirationDate,
      adminEmail: session.user.email,
    });

    if (!result.ok) {
      if (result.error === "invalid_date") {
        return NextResponse.json(
          { error: "Invalid date format" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    revalidatePath(`/users/${userId}`);

    return NextResponse.json({
      success: true,
      expirationDate: result.expirationDate.toISOString(),
    });
  } catch (error) {
    console.error("Error updating user expiration date:", error);
    return NextResponse.json(
      { error: "Failed to update expiration date" },
      { status: 500 }
    );
  }
}
