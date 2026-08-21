import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getOrCreateUserSubscribeLink } from "@/lib/backoffice/subscribe-link";
import { isVindiSubscriptionsEnabled } from "@/lib/vindi/config";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("billing:manage");
    if (!authz.ok) return authz.response;

    if (!isVindiSubscriptionsEnabled()) {
      return NextResponse.json(
        {
          error: "subscribe_link_not_available",
          reason:
            "O checkout Vindi está desligado neste ambiente (VINDI_SUBSCRIPTIONS_ENABLED).",
        },
        { status: 409 },
      );
    }

    const { id: userId } = await params;
    const result = await getOrCreateUserSubscribeLink({
      userId,
      adminEmail: authz.actor.email,
    });
    if (!result.ok) {
      if (result.error === "user_not_found") {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json(
        { error: result.error, reason: result.reason },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        subscribeUrl: result.subscribeUrl,
        expiresAt: result.expiresAt.toISOString(),
        reused: result.reused,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error creating user subscribe link:", error);
    return NextResponse.json(
      { error: "failed_to_create_subscribe_link" },
      { status: 500 },
    );
  }
}
