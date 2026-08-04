import { NextResponse } from "next/server";
import {
  BackofficeAuthorizationError,
  requireMarketingUserAccess,
} from "@/lib/auth/rbac";
import {
  listOpenPlaybookInsightsForUser,
  updatePlaybookInsightStatus,
} from "@/lib/db/playbook-insights-queries";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: userId } = await context.params;
    await requireMarketingUserAccess(userId, "marketing:read");

    const rows = await listOpenPlaybookInsightsForUser(userId);
    const insights = rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      severity: row.severity,
      confidence: row.confidence,
      entityLevel: row.entityLevel,
      entityId: row.entityId,
      entityName: row.entityName,
      actionType: row.actionType,
      title: row.title,
      evidence: row.evidence,
      recommendation: row.recommendation,
      metrics: row.metrics,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return NextResponse.json({ insights });
  } catch (error) {
    if (error instanceof BackofficeAuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[playbook-insights] GET failed", error);
    return NextResponse.json(
      { error: "Failed to load playbook insights" },
      { status: 500 },
    );
  }
}

type PatchBody = {
  insightId?: string;
  status?: "acknowledged" | "done" | "dismissed";
  reviewNote?: string | null;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: userId } = await context.params;
    const actor = await requireMarketingUserAccess(userId, "marketing:write");

    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.insightId) {
      return NextResponse.json(
        { error: "insightId is required" },
        { status: 400 },
      );
    }
    if (
      body.status !== "acknowledged" &&
      body.status !== "done" &&
      body.status !== "dismissed"
    ) {
      return NextResponse.json(
        { error: "status must be acknowledged, done, or dismissed" },
        { status: 400 },
      );
    }

    const updated = await updatePlaybookInsightStatus({
      insightId: body.insightId,
      userId,
      status: body.status,
      reviewedByEmail: actor.email,
      reviewNote: body.reviewNote ?? null,
    });

    if (!updated) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    });
  } catch (error) {
    if (error instanceof BackofficeAuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[playbook-insights] PATCH failed", error);
    return NextResponse.json(
      { error: "Failed to update playbook insight" },
      { status: 500 },
    );
  }
}
