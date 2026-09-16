import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clientReportBenchmark, metaTrackingDailyMetric } from "@/lib/db/schema";
import { lastCompleteWeek } from "./dates";
import { spendBucket } from "./payload-schema";

const MIN_SAMPLE = 20;

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export async function refreshWeeklyBenchmarks(now = new Date()) {
  const week = lastCompleteWeek(now);
  const rows = await db
    .select({
      userId: metaTrackingDailyMetric.userId,
      spend: sql<string>`coalesce(sum(${metaTrackingDailyMetric.spend}::numeric), 0)`,
      purchaseValue: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchaseValue}::numeric), 0)`,
      purchases: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchases}), 0)`,
    })
    .from(metaTrackingDailyMetric)
    .where(
      and(
        eq(metaTrackingDailyMetric.entityLevel, "campaign"),
        gte(metaTrackingDailyMetric.metricDate, week.start),
        lte(metaTrackingDailyMetric.metricDate, week.end),
      ),
    )
    .groupBy(metaTrackingDailyMetric.userId);

  const buckets = new Map<
    string,
    { roas: number[]; cpa: number[] }
  >();

  for (const row of rows) {
    const spend = toNumber(row.spend);
    const purchaseValue = toNumber(row.purchaseValue);
    const purchases = toNumber(row.purchases);
    if (!(spend > 0)) continue;
    const bucket = spendBucket(spend);
    const entry = buckets.get(bucket) ?? { roas: [], cpa: [] };
    entry.roas.push(purchaseValue / spend);
    if (purchases > 0) entry.cpa.push(spend / purchases);
    buckets.set(bucket, entry);
  }

  let written = 0;
  for (const [bucket, values] of buckets) {
    if (values.roas.length < MIN_SAMPLE) continue;
    const roas = [...values.roas].sort((a, b) => a - b);
    const cpa = [...values.cpa].sort((a, b) => a - b);
    await db
      .insert(clientReportBenchmark)
      .values({
        spendBucket: bucket,
        periodStart: week.start,
        periodEnd: week.end,
        sampleSize: values.roas.length,
        roasP25: percentile(roas, 25)?.toString() ?? null,
        roasP50: percentile(roas, 50)?.toString() ?? null,
        roasP75: percentile(roas, 75)?.toString() ?? null,
        cpaP25: percentile(cpa, 25)?.toString() ?? null,
        cpaP50: percentile(cpa, 50)?.toString() ?? null,
        cpaP75: percentile(cpa, 75)?.toString() ?? null,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          clientReportBenchmark.spendBucket,
          clientReportBenchmark.periodStart,
        ],
        set: {
          periodEnd: week.end,
          sampleSize: values.roas.length,
          roasP25: percentile(roas, 25)?.toString() ?? null,
          roasP50: percentile(roas, 50)?.toString() ?? null,
          roasP75: percentile(roas, 75)?.toString() ?? null,
          cpaP25: percentile(cpa, 25)?.toString() ?? null,
          cpaP50: percentile(cpa, 50)?.toString() ?? null,
          cpaP75: percentile(cpa, 75)?.toString() ?? null,
          computedAt: new Date(),
        },
      });
    written += 1;
  }

  return { periodStart: week.start, periodEnd: week.end, written };
}
