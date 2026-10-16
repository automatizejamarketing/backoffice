import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const { eq, sql } = await import("drizzle-orm");
const { platformAdjustmentWhere } = await import(
  "@/lib/client-reports/platform-adjustments"
);
const { db } = await import("@/lib/db");
const { clientReportSnapshot, metaTrackingChangeEvent } = await import(
  "@/lib/db/schema"
);

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

const apply = process.argv.includes("--apply");

const rows = await db
  .select({
    id: clientReportSnapshot.id,
    userId: clientReportSnapshot.userId,
    periodStart: clientReportSnapshot.periodStart,
    periodEnd: clientReportSnapshot.periodEnd,
    payload: clientReportSnapshot.payload,
  })
  .from(clientReportSnapshot);

let changed = 0;
let unchanged = 0;
let skipped = 0;
const examples: Array<{ before: number; after: number }> = [];

for (const row of rows) {
  const payload = row.payload as {
    workThisWeek?: { changeEvents?: unknown };
  };
  const before = payload.workThisWeek?.changeEvents;
  if (typeof before !== "number") {
    skipped += 1;
    continue;
  }

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(metaTrackingChangeEvent)
    .where(
      platformAdjustmentWhere(
        row.userId,
        dateOnly(row.periodStart),
        dateOnly(row.periodEnd),
      ),
    );
  const after = Number(counted?.count ?? 0);
  if (after === before) {
    unchanged += 1;
    continue;
  }

  changed += 1;
  if (examples.length < 8) examples.push({ before, after });
  if (!apply) continue;

  await db
    .update(clientReportSnapshot)
    .set({
      payload: sql`jsonb_set(${clientReportSnapshot.payload}, '{workThisWeek,changeEvents}', to_jsonb(${after}::int), true)`,
      updatedAt: new Date(),
    })
    .where(eq(clientReportSnapshot.id, row.id));
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      snapshots: rows.length,
      changed,
      unchanged,
      skipped,
      examples,
    },
    null,
    2,
  ),
);

process.exit(0);
