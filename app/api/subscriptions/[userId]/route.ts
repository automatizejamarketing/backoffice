import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  subscription,
  subscriptionEvent,
  user,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { auth } from "@/app/(auth)/auth";
import { updateUserExpirationWithAudit } from "@/lib/backoffice/user-field-updates";

const EVENT_TYPE_LABELS: Record<string, string> = {
  subscribed: "Assinatura iniciada",
  renewed: "Assinatura renovada",
  upgraded: "Upgrade de plano",
  downgraded: "Downgrade de plano",
  canceled: "Assinatura cancelada",
  reactivated: "Assinatura reativada",
  expired: "Assinatura expirada",
  payment_failed: "Pagamento falhou",
  payment_recovered: "Pagamento recuperado",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;

    const [userData] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [subscriptions, payments, events] = await Promise.all([
      db
        .select()
        .from(subscription)
        .where(eq(subscription.userId, userId))
        .orderBy(desc(subscription.createdAt)),
      db
        .select()
        .from(payment)
        .where(eq(payment.userId, userId))
        .orderBy(desc(payment.createdAt))
        .limit(20),
      db
        .select()
        .from(subscriptionEvent)
        .where(eq(subscriptionEvent.userId, userId))
        .orderBy(desc(subscriptionEvent.createdAt))
        .limit(20),
    ]);

    const activeSubscription = subscriptions.find(
      (s) => s.status === "active" || s.status === "past_due"
    );

    return NextResponse.json({
      user: {
        id: userData.id,
        email: userData.email,
        imageUrl: userData.image_url,
        expirationDate: userData.expirationDate?.toISOString(),
        stripeCustomerId: userData.stripeCustomerId,
      },
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
            planType: activeSubscription.planType,
            planName: PLAN_DEFINITIONS[activeSubscription.planType].name,
            status: activeSubscription.status,
            currentPeriodStart:
              activeSubscription.currentPeriodStart?.toISOString(),
            currentPeriodEnd:
              activeSubscription.currentPeriodEnd?.toISOString(),
            cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
            createdAt: activeSubscription.createdAt.toISOString(),
          }
        : null,
      subscriptionHistory: subscriptions.map((s) => ({
        id: s.id,
        planType: s.planType,
        planName: PLAN_DEFINITIONS[s.planType].name,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        endedAt: s.endedAt?.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        planType: p.planType,
        planName: PLAN_DEFINITIONS[p.planType].name,
        description: p.description,
        failureReason: p.failureReason,
        paidAt: p.paidAt?.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventLabel: EVENT_TYPE_LABELS[e.eventType] || e.eventType,
        fromPlan: e.fromPlan,
        fromPlanName: e.fromPlan ? PLAN_DEFINITIONS[e.fromPlan].name : null,
        toPlan: e.toPlan,
        toPlanName: e.toPlan ? PLAN_DEFINITIONS[e.toPlan].name : null,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching user subscription details:", error);
    return NextResponse.json(
      { error: "Failed to fetch user subscription details" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
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
