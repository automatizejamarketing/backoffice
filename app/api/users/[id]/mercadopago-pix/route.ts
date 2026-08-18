import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { BackofficePixStripeBlockError } from "@/lib/backoffice/pix-renewal-policy";
import { db } from "@/lib/db";
import { PLAN_TYPE_VALUES, user, type PlanType } from "@/lib/db/schema";
import {
  createOrReuseBackofficePixLink,
  sendBackofficePixLinkEmail,
} from "@/lib/mercadopago/pix";
import { formatMercadoPagoPixError } from "@/lib/mercadopago/pix-errors";
import { sendBackofficeVindiPixLinkEmail } from "@/lib/vindi/backoffice-pix-email";
import { createOrReuseBackofficeVindiPixForUser } from "@/lib/vindi/backoffice-pix-server";
import { isVindiSubscriptionsEnabled } from "@/lib/vindi/config";

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

    if (isVindiSubscriptionsEnabled()) {
      const created = await createOrReuseBackofficeVindiPixForUser({
        userId,
        planType: body.planType,
        adminEmail: authz.actor.email,
      });

      if (body.sendEmail) {
        await sendBackofficeVindiPixLinkEmail({
          to: targetUser.email,
          name: targetUser.name ?? targetUser.email,
          link: created.link,
        });
      }

      revalidatePath(`/users/${userId}`);
      revalidatePath(`/subscriptions/${userId}`);

      return NextResponse.json({
        link: created.link,
        reused: created.reused,
        emailed: body.sendEmail === true,
      });
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
        pixCopyPasteCode: link.pixCopyPasteCode,
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
        pixCopyPasteCode: link.pixCopyPasteCode,
        mercadopagoPaymentId: link.mercadopagoPaymentId,
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
    if (error instanceof BackofficePixStripeBlockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "Não foi possível gerar o Pix";
    console.error("Error creating backoffice Pix link:", error);
    return NextResponse.json(
      {
        error: isVindiSubscriptionsEnabled()
          ? message
          : formatMercadoPagoPixError(message),
      },
      { status: 500 },
    );
  }
}
