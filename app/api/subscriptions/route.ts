import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  subscription,
  user,
  type PlanType,
  type SubscriptionStatus,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { auth } from "@/app/(auth)/auth";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const status = searchParams.get("status") as SubscriptionStatus | null;
    const planType = searchParams.get("planType") as PlanType | null;

    const conditions = [];
    if (status) {
      conditions.push(eq(subscription.status, status));
    }
    if (planType) {
      conditions.push(eq(subscription.planType, planType));
    }

    const query = db
      .select({
        id: subscription.id,
        userId: subscription.userId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        planType: subscription.planType,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        createdAt: subscription.createdAt,
        user: {
          id: user.id,
          email: user.email,
          image_url: user.image_url,
          expirationDate: user.expirationDate,
          stripeCustomerId: user.stripeCustomerId,
        },
      })
      .from(subscription)
      .innerJoin(user, eq(subscription.userId, user.id))
      .orderBy(desc(subscription.createdAt))
      .limit(limit)
      .offset(offset);

    const results =
      conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

    const subscriptions = results.map((row) => ({
      id: row.id,
      userId: row.userId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      planType: row.planType,
      planName: PLAN_DEFINITIONS[row.planType].name,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart?.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt.toISOString(),
      user: {
        id: row.user.id,
        email: row.user.email,
        imageUrl: row.user.image_url,
        expirationDate: row.user.expirationDate?.toISOString(),
        stripeCustomerId: row.user.stripeCustomerId,
      },
    }));

    return NextResponse.json({
      subscriptions,
      pagination: {
        limit,
        offset,
        hasMore: subscriptions.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}
