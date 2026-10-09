import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PLAN_TYPE_VALUES, user, subscription, type PlanType } from "@/lib/db/schema";
import { subscriptionsBlockPixRenewal, PIX_RENEWAL_STRIPE_BLOCK_MESSAGE } from "@/lib/backoffice/pix-renewal-policy";
import { pixAutomaticLink } from "@/lib/backoffice/pix-automatic-link";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("billing:manage");
  if (!authz.ok) return authz.response;
  const plan = new URL(request.url).searchParams.get("plan");
  if (!plan || !(PLAN_TYPE_VALUES as readonly string[]).includes(plan))
    return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (!owner) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  const subscriptions = await db.select({ provider: subscription.provider, status: subscription.status }).from(subscription).where(eq(subscription.userId, id));
  if (subscriptionsBlockPixRenewal(subscriptions))
    return NextResponse.json({ error: PIX_RENEWAL_STRIPE_BLOCK_MESSAGE }, { status: 409 });
  // This is a checkout link, not a charge or an authorization. The frontend
  // rechecks the authenticated customer's history and eligibility at checkout.
  const origin = resolveFrontendAppUrl();
  return NextResponse.json(pixAutomaticLink(plan as PlanType, origin), { headers: { "Cache-Control": "private, no-store" } });
}
