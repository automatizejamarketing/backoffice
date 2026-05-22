import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  getBusinessOperatingRules,
  listBusinessRuleChangeLogs,
  updateBusinessOperatingRules,
} from "@/lib/db/business-queries";
import type { BusinessOperatingRules } from "@/lib/business/business-health";

function numberValue(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function parseRulesPatch(body: Record<string, unknown>) {
  const patch: Partial<BusinessOperatingRules> = {};
  const numberFields: Array<keyof Omit<
    BusinessOperatingRules,
    "managedCampaignNamePrefix" | "activeManagedCampaignExcludesInactivity"
  >> = [
    "renewalCriticalDays",
    "renewalAttentionDays",
    "trialCriticalDays",
    "trialAttentionDays",
    "inactivityAttentionDays",
    "lowCreditsThreshold",
  ];

  for (const field of numberFields) {
    const value = numberValue(body[field]);
    if (value !== undefined) {
      patch[field] = value;
    }
  }

  if (body.managedCampaignNamePrefix !== undefined) {
    if (typeof body.managedCampaignNamePrefix !== "string") {
      throw new Error("invalid_managedCampaignNamePrefix");
    }
    patch.managedCampaignNamePrefix = body.managedCampaignNamePrefix;
  }

  if (body.activeManagedCampaignExcludesInactivity !== undefined) {
    if (typeof body.activeManagedCampaignExcludesInactivity !== "boolean") {
      throw new Error("invalid_activeManagedCampaignExcludesInactivity");
    }
    patch.activeManagedCampaignExcludesInactivity =
      body.activeManagedCampaignExcludesInactivity;
  }

  return patch;
}

export async function GET() {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  const [rules, logs] = await Promise.all([
    getBusinessOperatingRules(),
    listBusinessRuleChangeLogs(25),
  ]);

  return NextResponse.json({ rules, logs });
}

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch = parseRulesPatch(body);
    const result = await updateBusinessOperatingRules(
      patch,
      authz.actor.email,
    );
    const logs = await listBusinessRuleChangeLogs(25);

    return NextResponse.json({ ...result, logs });
  } catch (error) {
    console.error("Error updating business rules:", error);
    return NextResponse.json(
      { error: "Regras inválidas ou falha ao salvar." },
      { status: 400 },
    );
  }
}
