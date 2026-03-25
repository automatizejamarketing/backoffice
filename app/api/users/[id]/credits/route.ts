import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { adjustUserCreditsWithAudit } from "@/lib/backoffice/user-field-updates";

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
    const { amount, description } = body as {
      amount: unknown;
      description?: string;
    };

    if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0) {
      return NextResponse.json(
        { error: "amount must be a non-zero integer" },
        { status: 400 }
      );
    }

    const result = await adjustUserCreditsWithAudit({
      userId,
      amount,
      adminEmail: session.user.email,
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : undefined,
    });

    if (!result.ok) {
      if (result.error === "User not found") {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    revalidatePath(`/users/${userId}`);

    return NextResponse.json(
      {
        success: true,
        credits: result.credits,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Error updating user credits:", error);
    return NextResponse.json(
      { error: "Failed to update credits" },
      { status: 500 }
    );
  }
}
