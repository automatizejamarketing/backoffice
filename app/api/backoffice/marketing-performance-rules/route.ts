import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  createCampaignPerformanceRule,
  deleteCampaignPerformanceRule,
  listCampaignPerformanceRules,
  updateCampaignPerformanceRule,
} from "@/lib/db/business-queries";
import {
  isSupportedMetric,
  isSupportedOperator,
} from "@/lib/marketing/performance-rules";

function parseThreshold(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_threshold");
  return parsed;
}

export async function GET() {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  const rules = await listCampaignPerformanceRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new Error("invalid_name");
    if (typeof body.metric !== "string" || !isSupportedMetric(body.metric)) {
      throw new Error("invalid_metric");
    }
    if (
      typeof body.operator !== "string" ||
      !isSupportedOperator(body.operator)
    ) {
      throw new Error("invalid_operator");
    }
    const threshold = parseThreshold(body.threshold);
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const description =
      typeof body.description === "string" && body.description.trim() !== ""
        ? body.description.trim()
        : null;

    const rule = await createCampaignPerformanceRule(
      { name, metric: body.metric, operator: body.operator, threshold, enabled, description },
      authz.actor.email,
    );
    const rules = await listCampaignPerformanceRules();
    return NextResponse.json({ rule, rules });
  } catch (error) {
    console.error("Error creating performance rule:", error);
    return NextResponse.json(
      { error: "Regra inválida ou falha ao salvar." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw new Error("invalid_id");

    const patch: {
      name?: string;
      enabled?: boolean;
      metric?: string;
      operator?: string;
      threshold?: number;
      description?: string | null;
    } = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new Error("invalid_name");
      patch.name = name;
    }
    if (body.metric !== undefined) {
      if (typeof body.metric !== "string" || !isSupportedMetric(body.metric)) {
        throw new Error("invalid_metric");
      }
      patch.metric = body.metric;
    }
    if (body.operator !== undefined) {
      if (
        typeof body.operator !== "string" ||
        !isSupportedOperator(body.operator)
      ) {
        throw new Error("invalid_operator");
      }
      patch.operator = body.operator;
    }
    if (body.threshold !== undefined) {
      patch.threshold = parseThreshold(body.threshold);
    }
    if (body.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }
    if (body.description !== undefined) {
      patch.description =
        typeof body.description === "string" && body.description.trim() !== ""
          ? body.description.trim()
          : null;
    }

    const rule = await updateCampaignPerformanceRule(
      id,
      patch,
      authz.actor.email,
    );
    if (!rule) {
      return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 });
    }
    const rules = await listCampaignPerformanceRules();
    return NextResponse.json({ rule, rules });
  } catch (error) {
    console.error("Error updating performance rule:", error);
    return NextResponse.json(
      { error: "Regra inválida ou falha ao salvar." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await deleteCampaignPerformanceRule(id);
  const rules = await listCampaignPerformanceRules();
  return NextResponse.json({ rules });
}
