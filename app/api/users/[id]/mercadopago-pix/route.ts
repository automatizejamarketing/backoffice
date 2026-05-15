import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PLAN_TYPE_VALUES, user, type PlanType } from "@/lib/db/schema";
import {
  createOrReuseBackofficePixLink,
  sendBackofficePixLinkEmail,
} from "@/lib/mercadopago/pix";

function isPlanType(value: unknown): value is PlanType {
  return (
    typeof value === "string" &&
    (PLAN_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("billing:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const body = (await request.json()) as {
      planType?: unknown;
      sendEmail?: boolean;
    };

    if (!isPlanType(body.planType)) {
      return NextResponse.json({ error: "Invalid plan type" }, { status: 400 });
    }

    const [targetUser] = await db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const link = await createOrReuseBackofficePixLink({
      userId,
      planType: body.planType,
      adminEmail: authz.actor.email,
    });

    if (body.sendEmail) {
      await sendBackofficePixLinkEmail({
        to: targetUser.email,
        name: targetUser.name ?? targetUser.email,
        link,
      });
    }

    revalidatePath(`/users/${userId}`);
    revalidatePath(`/subscriptions/${userId}`);

    return NextResponse.json({
      link: {
        id: link.id,
        planType: link.planType,
        amount: link.amount,
        currency: link.currency,
        preferenceId: link.preferenceId,
        initPoint: link.initPoint,
        status: link.status,
        source: link.source,
        adminEmail: link.adminEmail,
        expiresAt: link.expiresAt.toISOString(),
        createdAt: link.createdAt.toISOString(),
      },
      reused: link.reused,
      emailed: body.sendEmail === true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create Pix link";
    const status = message.includes("Stripe ativa") ? 409 : 500;
    console.error("Error creating backoffice Pix link:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
