import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  listProactivityAlertChangeLogs,
  listProactivityAlerts,
  updateProactivityAlerts,
  type ProactivityAlertPatch,
} from "@/lib/db/proactivity-alert-queries";
import { PROACTIVITY_ALERT_DEFINITIONS } from "@/lib/proactivity/catalog";

function parsePatches(body: unknown): ProactivityAlertPatch[] {
  if (!body || typeof body !== "object") {
    throw new Error("invalid_body");
  }
  const alerts = (body as { alerts?: unknown }).alerts;
  if (!Array.isArray(alerts)) {
    throw new Error("invalid_alerts");
  }

  return alerts.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("invalid_alert_item");
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      throw new Error("invalid_alert_id");
    }
    const patch: ProactivityAlertPatch = { id: row.id };
    if (row.enabled !== undefined) {
      if (typeof row.enabled !== "boolean") throw new Error("invalid_enabled");
      patch.enabled = row.enabled;
    }
    if (row.deliverWhatsapp !== undefined) {
      if (typeof row.deliverWhatsapp !== "boolean") {
        throw new Error("invalid_deliverWhatsapp");
      }
      patch.deliverWhatsapp = row.deliverWhatsapp;
    }
    if (row.deliverSlack !== undefined) {
      if (typeof row.deliverSlack !== "boolean") {
        throw new Error("invalid_deliverSlack");
      }
      patch.deliverSlack = row.deliverSlack;
    }
    if (row.thresholds !== undefined) {
      if (
        !row.thresholds ||
        typeof row.thresholds !== "object" ||
        Array.isArray(row.thresholds)
      ) {
        throw new Error("invalid_thresholds");
      }
      patch.thresholds = row.thresholds as Record<string, number>;
    }
    return patch;
  });
}

function serializeAlert(
  alert: Awaited<ReturnType<typeof listProactivityAlerts>>[number],
) {
  return {
    id: alert.id,
    ruleKey: alert.ruleKey,
    audience: alert.audience,
    enabled: alert.enabled,
    thresholds: alert.thresholds,
    deliverWhatsapp: alert.deliverWhatsapp,
    deliverSlack: alert.deliverSlack,
    updatedByEmail: alert.updatedByEmail,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    definition: {
      title: alert.definition.title,
      description: alert.definition.description,
      thresholdFields: alert.definition.thresholdFields,
      defaultThresholds: alert.definition.defaultThresholds,
    },
  };
}

export async function GET() {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  const [alerts, logs] = await Promise.all([
    listProactivityAlerts(),
    listProactivityAlertChangeLogs(40),
  ]);

  return NextResponse.json({
    alerts: alerts.map(serializeAlert),
    catalog: PROACTIVITY_ALERT_DEFINITIONS.map((def) => ({
      ruleKey: def.ruleKey,
      audience: def.audience,
      title: def.title,
      description: def.description,
      thresholdFields: def.thresholdFields,
      defaultThresholds: def.defaultThresholds,
    })),
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = await request.json();
    const patches = parsePatches(body);
    const { alerts } = await updateProactivityAlerts(
      patches,
      authz.actor.email,
    );
    const logs = await listProactivityAlertChangeLogs(40);

    return NextResponse.json({
      alerts: alerts.map(serializeAlert),
      logs: logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error updating proactivity alerts:", error);
    const message =
      error instanceof Error ? error.message : "Erro ao salvar alertas";
    return NextResponse.json(
      { error: "Alertas inválidos ou falha ao salvar.", detail: message },
      { status: 400 },
    );
  }
}
