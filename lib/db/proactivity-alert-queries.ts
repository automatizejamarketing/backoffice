import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  proactivityAlert,
  proactivityAlertChangeLog,
  type ProactivityAlert,
  type ProactivityAudience,
} from "@/lib/db/schema";
import {
  getAlertDefinition,
  PROACTIVITY_ALERT_DEFINITIONS,
  seedRowsFromCatalog,
  validateAlertChannels,
  validateAlertThresholds,
  type ProactivityAlertDefinition,
} from "@/lib/proactivity/catalog";

export type ProactivityAlertRecord = {
  id: string;
  ruleKey: string;
  audience: ProactivityAudience;
  enabled: boolean;
  thresholds: Record<string, number>;
  deliverWhatsapp: boolean;
  deliverSlack: boolean;
  updatedByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  definition: ProactivityAlertDefinition;
};

export type ProactivityAlertChangeLogItem = {
  id: string;
  alertId: string;
  adminEmail: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  createdAt: Date;
};

export type ProactivityAlertPatch = {
  id: string;
  enabled?: boolean;
  thresholds?: Record<string, number>;
  deliverWhatsapp?: boolean;
  deliverSlack?: boolean;
};

function asThresholds(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }
  return result;
}

function toRecord(row: ProactivityAlert): ProactivityAlertRecord | null {
  const definition = getAlertDefinition(row.ruleKey, row.audience);
  if (!definition) return null;
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    audience: row.audience,
    enabled: row.enabled,
    thresholds: asThresholds(row.thresholds),
    deliverWhatsapp: row.deliverWhatsapp,
    deliverSlack: row.deliverSlack,
    updatedByEmail: row.updatedByEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    definition,
  };
}

/** Ensure catalog rows exist (idempotent). */
export async function ensureProactivityAlertsSeeded(): Promise<void> {
  const seeds = seedRowsFromCatalog();
  for (const seed of seeds) {
    await db
      .insert(proactivityAlert)
      .values({
        ruleKey: seed.ruleKey,
        audience: seed.audience,
        enabled: seed.enabled,
        thresholds: seed.thresholds,
        deliverWhatsapp: seed.deliverWhatsapp,
        deliverSlack: seed.deliverSlack,
      })
      .onConflictDoNothing({
        target: [proactivityAlert.ruleKey, proactivityAlert.audience],
      });
  }
}

export async function listProactivityAlerts(options?: {
  audience?: ProactivityAudience;
}): Promise<ProactivityAlertRecord[]> {
  await ensureProactivityAlertsSeeded();

  const rows = options?.audience
    ? await db
        .select()
        .from(proactivityAlert)
        .where(eq(proactivityAlert.audience, options.audience))
        .orderBy(asc(proactivityAlert.audience), asc(proactivityAlert.ruleKey))
    : await db
        .select()
        .from(proactivityAlert)
        .orderBy(asc(proactivityAlert.audience), asc(proactivityAlert.ruleKey));

  const byKey = new Map(
    rows.map((row) => [`${row.ruleKey}:${row.audience}`, row]),
  );

  // Preserve catalog order
  const ordered: ProactivityAlertRecord[] = [];
  for (const def of PROACTIVITY_ALERT_DEFINITIONS) {
    if (options?.audience && def.audience !== options.audience) continue;
    const row = byKey.get(`${def.ruleKey}:${def.audience}`);
    if (!row) continue;
    const record = toRecord(row);
    if (record) ordered.push(record);
  }
  return ordered;
}

export async function listProactivityAlertChangeLogs(
  limit = 50,
): Promise<ProactivityAlertChangeLogItem[]> {
  return db
    .select({
      id: proactivityAlertChangeLog.id,
      alertId: proactivityAlertChangeLog.alertId,
      adminEmail: proactivityAlertChangeLog.adminEmail,
      fieldName: proactivityAlertChangeLog.fieldName,
      oldValue: proactivityAlertChangeLog.oldValue,
      newValue: proactivityAlertChangeLog.newValue,
      createdAt: proactivityAlertChangeLog.createdAt,
    })
    .from(proactivityAlertChangeLog)
    .orderBy(desc(proactivityAlertChangeLog.createdAt))
    .limit(limit);
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export async function updateProactivityAlerts(
  patches: ProactivityAlertPatch[],
  adminEmail: string,
): Promise<{ alerts: ProactivityAlertRecord[] }> {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("empty_patch");
  }

  await db.transaction(async (tx) => {
    for (const patch of patches) {
      if (!patch.id || typeof patch.id !== "string") {
        throw new Error("invalid_alert_id");
      }

      const [current] = await tx
        .select()
        .from(proactivityAlert)
        .where(eq(proactivityAlert.id, patch.id))
        .limit(1);

      if (!current) {
        throw new Error("alert_not_found");
      }

      const definition = getAlertDefinition(current.ruleKey, current.audience);
      if (!definition) {
        throw new Error("unknown_alert_definition");
      }

      const nextEnabled =
        patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled;
      const nextThresholds =
        patch.thresholds !== undefined
          ? validateAlertThresholds(definition, patch.thresholds)
          : asThresholds(current.thresholds);
      const nextWhatsapp =
        patch.deliverWhatsapp !== undefined
          ? Boolean(patch.deliverWhatsapp)
          : current.deliverWhatsapp;
      const nextSlack =
        patch.deliverSlack !== undefined
          ? Boolean(patch.deliverSlack)
          : current.deliverSlack;

      validateAlertChannels({
        audience: current.audience,
        deliverWhatsapp: nextWhatsapp,
        deliverSlack: nextSlack,
      });

      const changes: Array<{ fieldName: string; oldValue: string | null; newValue: string }> =
        [];

      if (nextEnabled !== current.enabled) {
        changes.push({
          fieldName: "enabled",
          oldValue: String(current.enabled),
          newValue: String(nextEnabled),
        });
      }
      if (
        serializeValue(nextThresholds) !==
        serializeValue(asThresholds(current.thresholds))
      ) {
        changes.push({
          fieldName: "thresholds",
          oldValue: serializeValue(asThresholds(current.thresholds)),
          newValue: serializeValue(nextThresholds),
        });
      }
      if (nextWhatsapp !== current.deliverWhatsapp) {
        changes.push({
          fieldName: "deliverWhatsapp",
          oldValue: String(current.deliverWhatsapp),
          newValue: String(nextWhatsapp),
        });
      }
      if (nextSlack !== current.deliverSlack) {
        changes.push({
          fieldName: "deliverSlack",
          oldValue: String(current.deliverSlack),
          newValue: String(nextSlack),
        });
      }

      if (changes.length === 0) continue;

      await tx
        .update(proactivityAlert)
        .set({
          enabled: nextEnabled,
          thresholds: nextThresholds,
          deliverWhatsapp: nextWhatsapp,
          deliverSlack: nextSlack,
          updatedByEmail: adminEmail,
          updatedAt: new Date(),
        })
        .where(eq(proactivityAlert.id, current.id));

      for (const change of changes) {
        await tx.insert(proactivityAlertChangeLog).values({
          alertId: current.id,
          adminEmail,
          fieldName: change.fieldName,
          oldValue: change.oldValue,
          newValue: change.newValue,
        });
      }
    }
  });

  return { alerts: await listProactivityAlerts() };
}

export async function getProactivityAlertsForAudience(
  audience: ProactivityAudience,
): Promise<ProactivityAlertRecord[]> {
  return listProactivityAlerts({ audience });
}

/** Resolve consultant playbook config from DB alerts (with catalog defaults). */
export async function getConsultantPlaybookAlertConfig(): Promise<{
  enabledPlaybookRuleIds: Set<string>;
  thresholdsByPlaybookRuleId: Map<string, Record<string, number>>;
  deliverSlackByPlaybookRuleId: Map<string, { alertId: string; enabled: boolean }>;
}> {
  const alerts = await getProactivityAlertsForAudience("consultant");
  const enabledPlaybookRuleIds = new Set<string>();
  const thresholdsByPlaybookRuleId = new Map<string, Record<string, number>>();
  const deliverSlackByPlaybookRuleId = new Map<
    string,
    { alertId: string; enabled: boolean }
  >();

  for (const alert of alerts) {
    const playbookRuleId = alert.definition.playbookRuleId;
    if (!playbookRuleId) continue;
    thresholdsByPlaybookRuleId.set(playbookRuleId, {
      ...alert.definition.defaultThresholds,
      ...alert.thresholds,
    });
    deliverSlackByPlaybookRuleId.set(playbookRuleId, {
      alertId: alert.id,
      enabled: alert.enabled && alert.deliverSlack,
    });
    if (alert.enabled) {
      enabledPlaybookRuleIds.add(playbookRuleId);
    }
  }

  // If a catalog rule has no DB row yet, treat as enabled with defaults
  for (const def of PROACTIVITY_ALERT_DEFINITIONS) {
    if (def.audience !== "consultant" || !def.playbookRuleId) continue;
    if (!thresholdsByPlaybookRuleId.has(def.playbookRuleId)) {
      thresholdsByPlaybookRuleId.set(def.playbookRuleId, {
        ...def.defaultThresholds,
      });
      enabledPlaybookRuleIds.add(def.playbookRuleId);
    }
  }

  return {
    enabledPlaybookRuleIds,
    thresholdsByPlaybookRuleId,
    deliverSlackByPlaybookRuleId,
  };
}

export async function getAlertByRuleKeyAudience(
  ruleKey: string,
  audience: ProactivityAudience,
): Promise<ProactivityAlertRecord | null> {
  const [row] = await db
    .select()
    .from(proactivityAlert)
    .where(
      and(
        eq(proactivityAlert.ruleKey, ruleKey),
        eq(proactivityAlert.audience, audience),
      ),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}
