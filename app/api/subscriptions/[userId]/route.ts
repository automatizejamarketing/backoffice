import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  pendingPlanChange,
  subscription,
  subscriptionEvent,
  user,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { auth } from "@/app/(auth)/auth";
import { updateUserExpirationWithAudit } from "@/lib/backoffice/user-field-updates";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";

const EVENT_TYPE_LABELS: Record<string, string> = {
  subscribed: "Assinatura iniciada",
  renewed: "Assinatura renovada",
  upgraded: "Upgrade de plano",
  downgraded: "Downgrade de plano",
  plan_changed: "Mudança de plano",
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

    const [subscriptions, payments, events, pendingChanges] = await Promise.all(
      [
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
          .limit(50),
        db
          .select()
          .from(subscriptionEvent)
          .where(eq(subscriptionEvent.userId, userId))
          .orderBy(desc(subscriptionEvent.createdAt))
          .limit(50),
        db
          .select()
          .from(pendingPlanChange)
          .where(
            and(
              eq(pendingPlanChange.userId, userId),
              eq(pendingPlanChange.status, "pending"),
            ),
          )
          .orderBy(desc(pendingPlanChange.createdAt))
          .limit(1),
      ],
    );

    const activeSubscription = pickActiveSubscription(subscriptions);
    const activePendingPlanChange = pendingChanges[0] ?? null;

    return NextResponse.json({
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        locale: userData.locale,
        authProvider: userData.authProvider,
        imageUrl: userData.image_url,
        expirationDate: userData.expirationDate?.toISOString(),
        stripeCustomerId: userData.stripeCustomerId,
        credits: userData.credits,
      },
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
            stripePriceId: activeSubscription.stripePriceId,
            planType: activeSubscription.planType,
            planName: PLAN_DEFINITIONS[activeSubscription.planType].name,
            status: activeSubscription.status,
            currentPeriodStart:
              activeSubscription.currentPeriodStart?.toISOString(),
            currentPeriodEnd:
              activeSubscription.currentPeriodEnd?.toISOString(),
            cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
            canceledAt: activeSubscription.canceledAt?.toISOString(),
            endedAt: activeSubscription.endedAt?.toISOString(),
            commitmentEndDate:
              activeSubscription.commitmentEndDate?.toISOString(),
            commitmentMonths: activeSubscription.commitmentMonths,
            createdAt: activeSubscription.createdAt.toISOString(),
            updatedAt: activeSubscription.updatedAt.toISOString(),
          }
        : null,
      pendingPlanChange: activePendingPlanChange
        ? {
            id: activePendingPlanChange.id,
            subscriptionId: activePendingPlanChange.subscriptionId,
            currentPlanType: activePendingPlanChange.currentPlanType,
            currentPlanName:
              PLAN_DEFINITIONS[activePendingPlanChange.currentPlanType].name,
            newPlanType: activePendingPlanChange.newPlanType,
            newPlanName:
              PLAN_DEFINITIONS[activePendingPlanChange.newPlanType].name,
            newStripePriceId: activePendingPlanChange.newStripePriceId,
            changeType: activePendingPlanChange.changeType,
            effectiveDate:
              activePendingPlanChange.effectiveDate.toISOString(),
            status: activePendingPlanChange.status,
            createdAt: activePendingPlanChange.createdAt.toISOString(),
            updatedAt: activePendingPlanChange.updatedAt.toISOString(),
          }
        : null,
      subscriptionHistory: subscriptions.map((s) => ({
        id: s.id,
        stripeSubscriptionId: s.stripeSubscriptionId,
        stripePriceId: s.stripePriceId,
        planType: s.planType,
        planName: PLAN_DEFINITIONS[s.planType].name,
        status: s.status,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        currentPeriodStart: s.currentPeriodStart?.toISOString(),
        currentPeriodEnd: s.currentPeriodEnd?.toISOString(),
        commitmentMonths: s.commitmentMonths,
        commitmentEndDate: s.commitmentEndDate?.toISOString(),
        canceledAt: s.canceledAt?.toISOString(),
        endedAt: s.endedAt?.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
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
        stripeInvoiceId: p.stripeInvoiceId,
        stripePaymentIntentId: p.stripePaymentIntentId,
        stripeChargeId: p.stripeChargeId,
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
    revalidatePath(`/subscriptions/${userId}`);

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
