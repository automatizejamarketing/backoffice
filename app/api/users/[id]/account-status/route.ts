import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { subscription, user } from "@/lib/db/schema";
import {
  getAccessBadgeProps,
  getStripeBillingBadgeProps,
  pickActiveSubscription,
  type StatusBadgeProps,
} from "@/lib/subscriptions/derive";

export type MarketingAccountStatusResponse = {
  access: StatusBadgeProps;
  billing: StatusBadgeProps | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await params;
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;

  try {
    const [[account], subscriptions] = await Promise.all([
      db.select({ expirationDate: user.expirationDate })
        .from(user).where(eq(user.id, userId)).limit(1),
      db.select({
        provider: subscription.provider,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodEnd: subscription.currentPeriodEnd,
        createdAt: subscription.createdAt,
      }).from(subscription).where(eq(subscription.userId, userId)),
    ]);
    if (!account) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const currentSubscription = pickActiveSubscription(subscriptions);
    const payload: MarketingAccountStatusResponse = {
      access: getAccessBadgeProps(account.expirationDate),
      billing: currentSubscription?.provider === "stripe"
        ? getStripeBillingBadgeProps(currentSubscription)
        : null,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching marketing account status:", error);
    return NextResponse.json(
      { error: "Não foi possível consultar o status da conta" },
      { status: 500 },
    );
  }
}
