import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clientReportBenchmark,
  clientReportMission,
  clientReportSnapshot,
  metaTrackingChangeEvent,
  metaTrackingDailyMetric,
  payment,
  performanceInsight,
  subscription,
  user,
} from "@/lib/db/schema";
import {
  allocatePlanCost,
  computeRoasPair,
  paymentAmountReais,
} from "@/lib/performance-report/analysis";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import {
  computeMonthsPaidBack,
  emptyPayload,
  headlineForState,
  isClientReportPayloadV1,
  percentileRank,
  resolveHeadlineState,
  spendBucket,
  type ClientReportAction,
  type ClientReportCampaignCard,
  type ClientReportCreativeCard,
  type ClientReportOutcome,
  type ClientReportPayloadV1,
  type ClientReportPeriodType,
} from "./payload-schema";
import { inclusiveDays, previousWindow } from "./dates";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

type Totals = {
  spend: number;
  purchaseValue: number;
  purchases: number;
  impressions: number;
  clicks: number;
};

function emptyTotals(): Totals {
  return {
    spend: 0,
    purchaseValue: 0,
    purchases: 0,
    impressions: 0,
    clicks: 0,
  };
}

async function aggregateCampaignMetrics(input: {
  userId: string;
  start: string;
  end: string;
}): Promise<{ totals: Totals; campaigns: ClientReportCampaignCard[] }> {
  const rows = await db
    .select({
      entityId: metaTrackingDailyMetric.entityId,
      spend: sql<string>`coalesce(sum(${metaTrackingDailyMetric.spend}::numeric), 0)`,
      purchaseValue: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchaseValue}::numeric), 0)`,
      purchases: sql<string>`coalesce(sum(${metaTrackingDailyMetric.purchases}), 0)`,
      impressions: sql<string>`coalesce(sum(${metaTrackingDailyMetric.impressions}), 0)`,
      clicks: sql<string>`coalesce(sum(${metaTrackingDailyMetric.clicks}), 0)`,
    })
    .from(metaTrackingDailyMetric)
    .where(
      and(
        eq(metaTrackingDailyMetric.userId, input.userId),
        eq(metaTrackingDailyMetric.entityLevel, "campaign"),
        gte(metaTrackingDailyMetric.metricDate, input.start),
        lte(metaTrackingDailyMetric.metricDate, input.end),
      ),
    )
    .groupBy(metaTrackingDailyMetric.entityId);

  const totals = emptyTotals();
  const campaigns: ClientReportCampaignCard[] = [];

  for (const row of rows) {
    const spend = toNumber(row.spend);
    const purchaseValue = toNumber(row.purchaseValue);
    const purchases = toNumber(row.purchases);
    totals.spend += spend;
    totals.purchaseValue += purchaseValue;
    totals.purchases += purchases;
    totals.impressions += toNumber(row.impressions);
    totals.clicks += toNumber(row.clicks);
    campaigns.push({
      id: row.entityId,
      name: row.entityId,
      spend,
      purchaseValue,
      purchases,
      roas: spend > 0 ? purchaseValue / spend : null,
      cpa: purchases > 0 ? spend / purchases : null,
    });
  }

  return { totals, campaigns };
}

async function loadPlan(userId: string): Promise<{
  planAmountReais: number | null;
  monthlyPlanPrice: number | null;
  billingCycleDays: number;
  hasPayment: boolean;
  expirationDate: string | null;
  currency: string | null;
  provider: string | null;
}> {
  const [userRow] = await db
    .select({
      expirationDate: user.expirationDate,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const [latestPayment] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.userId, userId), eq(payment.status, "succeeded")))
    .orderBy(desc(payment.paidAt), desc(payment.createdAt))
    .limit(1);

  const [latestSub] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(desc(subscription.updatedAt))
    .limit(1);

  const planType = latestPayment?.planType ?? latestSub?.planType ?? null;
  const monthlyFromCatalog = planType
    ? PLAN_DEFINITIONS[planType]?.monthlyPriceCentavos / 100
    : null;
  const paidReais = latestPayment
    ? paymentAmountReais(latestPayment.amount)
    : null;

  return {
    planAmountReais: paidReais ?? monthlyFromCatalog,
    monthlyPlanPrice: monthlyFromCatalog ?? paidReais,
    billingCycleDays: (latestSub?.commitmentMonths ?? 1) * 30,
    hasPayment: Boolean(latestPayment),
    expirationDate: userRow?.expirationDate
      ? userRow.expirationDate.toISOString()
      : null,
    currency: latestPayment?.currency ?? "BRL",
    provider: latestSub?.provider ?? latestPayment?.provider ?? null,
  };
}

async function loadCreatives(
  userId: string,
  start: string,
  end: string,
): Promise<ClientReportCreativeCard[]> {
  const rows = await db.execute(sql`
    SELECT
      ad_id,
      COALESCE(diagnosis->>'summary', '') AS summary,
      COALESCE(diagnosis->'craftGaps', '[]'::jsonb) AS craft_gaps,
      COALESCE(likely_contributor, false) AS likely_contributor
    FROM creative_diagnoses
    WHERE user_id = ${userId}
      AND created_at >= ${start}::date
      AND created_at < (${end}::date + interval '1 day')
      AND likely_contributor = true
    ORDER BY created_at DESC
    LIMIT 5
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const gaps = Array.isArray(row.craft_gaps)
      ? row.craft_gaps.map((gap) =>
          typeof gap === "string"
            ? gap
            : String((gap as { dimension?: string }).dimension ?? ""),
        )
      : [];
    return {
      adId: String(row.ad_id ?? ""),
      name: null,
      summary: String(row.summary ?? ""),
      craftGaps: gaps.filter(Boolean).slice(0, 4),
      likelyContributor: true,
      purchaseValue: null,
    };
  });
}

async function loadActions(userId: string): Promise<ClientReportAction[]> {
  const insights = await db
    .select({
      title: performanceInsight.title,
      recommendation: performanceInsight.recommendation,
      entityName: performanceInsight.entityName,
    })
    .from(performanceInsight)
    .where(
      and(
        eq(performanceInsight.userId, userId),
        eq(performanceInsight.status, "open"),
      ),
    )
    .orderBy(desc(performanceInsight.createdAt))
    .limit(3);

  const signals = await db.execute(sql`
    SELECT title, message, action_prompt, deep_link, metrics
    FROM proactive_signals
    WHERE user_id = ${userId}
      AND status = 'open'
    ORDER BY last_detected_at DESC
    LIMIT 5
  `);

  const fromSignals = (
    signals as unknown as Array<Record<string, unknown>>
  ).map((row) => {
    const metrics =
      row.metrics && typeof row.metrics === "object"
        ? (row.metrics as Record<string, unknown>)
        : {};
    const weekly =
      toNumber(metrics.weeklyPurchaseValue) ||
      toNumber(metrics.estimatedWeeklyRevenue);
    return {
      title: String(row.title ?? "Ação"),
      message: String(row.message ?? ""),
      actionPrompt: row.action_prompt ? String(row.action_prompt) : null,
      deepLink: String(row.deep_link ?? "/app/mat"),
      estimatedWeeklyRevenue: weekly > 0 ? weekly : null,
    };
  });

  const fromInsights: ClientReportAction[] = insights.map((row) => ({
    title: row.title,
    message: row.recommendation,
    actionPrompt: `Sobre ${row.entityName ?? "a conta"}: ${row.recommendation}`,
    deepLink: "/app/mat",
    estimatedWeeklyRevenue: null,
  }));

  return [...fromSignals, ...fromInsights].slice(0, 3);
}

async function loadWorkThisWeek(
  userId: string,
  start: string,
  end: string,
): Promise<ClientReportPayloadV1["workThisWeek"]> {
  const [changes] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(metaTrackingChangeEvent)
    .where(
      and(
        eq(metaTrackingChangeEvent.userId, userId),
        gte(metaTrackingChangeEvent.occurredAt, new Date(`${start}T00:00:00Z`)),
        lte(metaTrackingChangeEvent.occurredAt, new Date(`${end}T23:59:59Z`)),
      ),
    );

  const diagnoses = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM creative_diagnoses
    WHERE user_id = ${userId}
      AND created_at >= ${start}::date
      AND created_at < (${end}::date + interval '1 day')
  `);
  const alerts = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM proactive_signals
    WHERE user_id = ${userId}
      AND last_detected_at >= ${start}::date
      AND last_detected_at < (${end}::date + interval '1 day')
  `);

  return {
    changeEvents: Number(changes?.count ?? 0),
    diagnoses: Number(
      (diagnoses as unknown as Array<{ count?: number }>)[0]?.count ?? 0,
    ),
    alerts: Number(
      (alerts as unknown as Array<{ count?: number }>)[0]?.count ?? 0,
    ),
  };
}

function buildOutcomes(
  previous: ClientReportPayloadV1 | null,
  current: Totals,
): ClientReportOutcome[] {
  if (!previous) return [];
  const outcomes: ClientReportOutcome[] = [];
  const prevCpa =
    previous.scorecard.purchases > 0
      ? previous.scorecard.spend / previous.scorecard.purchases
      : null;
  const currCpa =
    current.purchases > 0 ? current.spend / current.purchases : null;
  if (prevCpa !== null && currCpa !== null && currCpa < prevCpa) {
    outcomes.push({
      action: "Ajustes da semana anterior",
      result: `CPA caiu de R$ ${prevCpa.toFixed(0)} para R$ ${currCpa.toFixed(0)}.`,
    });
  }
  for (const action of previous.actions.slice(0, 2)) {
    outcomes.push({
      action: action.title,
      result:
        current.purchaseValue >= previous.scorecard.purchaseValue
          ? "As vendas atribuídas se mantiveram ou subiram depois da ação."
          : "Ainda em acompanhamento — o resultado ainda não apareceu no pixel.",
    });
  }
  return outcomes.slice(0, 3);
}

function computeStreak(
  previousPayloads: Array<ClientReportPayloadV1 | null>,
  currentNet: number | null,
  currentSpend: number,
): { weeks: number; frozen: boolean } {
  const frozen = currentSpend === 0;
  if (frozen) {
    const last = previousPayloads.find((row) => row !== null);
    return { weeks: last?.streak.weeks ?? 0, frozen: true };
  }
  let weeks = currentNet !== null && currentNet > 0 ? 1 : 0;
  if (weeks === 0) return { weeks: 0, frozen: false };
  for (const payload of previousPayloads) {
    if (!payload) break;
    if (payload.streak.frozen) continue;
    if ((payload.scorecard.netReturn ?? 0) > 0) {
      weeks += 1;
      continue;
    }
    break;
  }
  return { weeks, frozen: false };
}

export async function buildReportSnapshot(input: {
  userId: string;
  periodType: ClientReportPeriodType;
  periodStart: string;
  periodEnd: string;
}): Promise<{
  snapshotId: string;
  payload: ClientReportPayloadV1;
  monthsPaidBack: number | null;
  isPersonalBest: boolean;
}> {
  const windowDays = inclusiveDays(input.periodStart, input.periodEnd);
  const period = {
    type: input.periodType,
    start: input.periodStart,
    end: input.periodEnd,
    windowDays,
  };
  const payload = emptyPayload(period);

  const [{ totals, campaigns }, plan, prev] = await Promise.all([
    aggregateCampaignMetrics({
      userId: input.userId,
      start: input.periodStart,
      end: input.periodEnd,
    }),
    loadPlan(input.userId),
    previousWindow(input.periodStart, input.periodEnd),
  ]);

  const previousMetrics = await aggregateCampaignMetrics({
    userId: input.userId,
    start: prev.start,
    end: prev.end,
  });

  const allocatedPlanCost = plan.planAmountReais
    ? allocatePlanCost({
        planAmountReais: plan.planAmountReais,
        billingCycleDays: plan.billingCycleDays,
        windowDays,
      })
    : null;

  const roasPair = computeRoasPair({
    purchaseValue: totals.purchaseValue,
    spend: totals.spend,
    allocatedPlanCost,
    spendCurrency: plan.currency,
    planCurrency: plan.currency,
    hasPayment: plan.hasPayment,
  });

  const prevAllocated = plan.planAmountReais
    ? allocatePlanCost({
        planAmountReais: plan.planAmountReais,
        billingCycleDays: plan.billingCycleDays,
        windowDays,
      })
    : null;
  const prevRoas = computeRoasPair({
    purchaseValue: previousMetrics.totals.purchaseValue,
    spend: previousMetrics.totals.spend,
    allocatedPlanCost: prevAllocated,
    spendCurrency: plan.currency,
    planCurrency: plan.currency,
    hasPayment: plan.hasPayment,
  });

  const netReturn =
    roasPair.totalCost !== null
      ? totals.purchaseValue - roasPair.totalCost
      : totals.purchaseValue - totals.spend;

  const lifetime = await aggregateCampaignMetrics({
    userId: input.userId,
    start: "2020-01-01",
    end: input.periodEnd,
  });
  const lifetimeDays = await db
    .select({
      firstDate: sql<string>`min(${metaTrackingDailyMetric.metricDate})`,
    })
    .from(metaTrackingDailyMetric)
    .where(
      and(
        eq(metaTrackingDailyMetric.userId, input.userId),
        eq(metaTrackingDailyMetric.entityLevel, "campaign"),
      ),
    );
  const firstDate = lifetimeDays[0]?.firstDate;
  const daysOfData = firstDate
    ? inclusiveDays(firstDate, input.periodEnd)
    : windowDays;

  const lifetimeAllocated = plan.monthlyPlanPrice
    ? allocatePlanCost({
        planAmountReais: plan.monthlyPlanPrice * Math.max(1, daysOfData / 30),
        billingCycleDays: daysOfData,
        windowDays: daysOfData,
      })
    : null;
  const lifetimeRoas = computeRoasPair({
    purchaseValue: lifetime.totals.purchaseValue,
    spend: lifetime.totals.spend,
    allocatedPlanCost: lifetimeAllocated,
    spendCurrency: plan.currency,
    planCurrency: plan.currency,
    hasPayment: plan.hasPayment,
  });
  const cumulativeNet =
    lifetimeRoas.totalCost !== null
      ? lifetime.totals.purchaseValue - lifetimeRoas.totalCost
      : lifetime.totals.purchaseValue - lifetime.totals.spend;

  const paidBack = computeMonthsPaidBack({
    cumulativeNetReturn: cumulativeNet,
    monthlyPlanPrice: plan.monthlyPlanPrice,
    daysOfData,
    roasAdjusted: lifetimeRoas.roasAdjusted ?? roasPair.roasAdjusted,
    purchases: lifetime.totals.purchases,
  });

  const headlineState = resolveHeadlineState({
    roasAdjusted: roasPair.roasAdjusted,
    purchaseValue: totals.purchaseValue,
    spend: totals.spend,
  });
  const headline = headlineForState({
    state: headlineState,
    purchaseValue: totals.purchaseValue,
    netReturn,
    monthsPaidBack: paidBack.months,
  });

  const ranked = [...campaigns].sort(
    (a, b) => (b.roas ?? 0) - (a.roas ?? 0),
  );
  const best = ranked.filter((row) => (row.roas ?? 0) >= 2).slice(0, 3);
  const needsAttention = [...campaigns]
    .filter((row) => row.spend > 0 && (row.roas === null || row.roas < 1))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3);

  const [creatives, actions, workThisWeek, previousSnapshots, benchmark] =
    await Promise.all([
      loadCreatives(input.userId, input.periodStart, input.periodEnd),
      loadActions(input.userId),
      loadWorkThisWeek(input.userId, input.periodStart, input.periodEnd),
      db
        .select()
        .from(clientReportSnapshot)
        .where(
          and(
            eq(clientReportSnapshot.userId, input.userId),
            eq(clientReportSnapshot.periodType, input.periodType),
          ),
        )
        .orderBy(desc(clientReportSnapshot.periodStart))
        .limit(12),
      db
        .select()
        .from(clientReportBenchmark)
        .where(eq(clientReportBenchmark.spendBucket, spendBucket(totals.spend)))
        .orderBy(desc(clientReportBenchmark.periodStart))
        .limit(1),
    ]);

  const previousPayloads = previousSnapshots
    .filter((row) => row.periodStart !== input.periodStart)
    .map((row) =>
      isClientReportPayloadV1(row.payload) ? row.payload : null,
    );

  const isPersonalBest =
    totals.spend >= 50 &&
    totals.purchaseValue >
      Math.max(
        0,
        ...previousPayloads.map((row) => row?.scorecard.purchaseValue ?? 0),
      );

  const bench = benchmark[0];
  const medianRoas = bench ? toNumber(bench.roasP50) : 0;
  const percentile =
    bench && (bench.sampleSize ?? 0) >= 20 && roasPair.roasMeta
      ? percentileRank(roasPair.roasMeta, medianRoas)
      : null;

  payload.headline = { state: headlineState, ...headline };
  payload.scorecard = {
    spend: totals.spend,
    purchaseValue: totals.purchaseValue,
    purchases: totals.purchases,
    netReturn,
    roasMeta: roasPair.roasMeta,
    roasAdjusted: roasPair.roasAdjusted,
    planCostAllocated: roasPair.allocatedPlanCost,
    impressions: totals.impressions,
    clicks: totals.clicks,
    delta: {
      spend: totals.spend - previousMetrics.totals.spend,
      purchaseValue:
        totals.purchaseValue - previousMetrics.totals.purchaseValue,
      netReturn:
        previousMetrics.totals.spend > 0
          ? netReturn -
            (previousMetrics.totals.purchaseValue -
              previousMetrics.totals.spend)
          : null,
      roasAdjusted:
        roasPair.roasAdjusted !== null && prevRoas.roasAdjusted !== null
          ? roasPair.roasAdjusted - prevRoas.roasAdjusted
          : null,
    },
  };
  payload.paidBack = {
    ...paidBack,
    monthlyPlanPrice: plan.monthlyPlanPrice,
    cumulativeNetReturn: cumulativeNet,
    daysOfData,
    expirationDate: plan.expirationDate,
  };
  payload.campaigns = { best, needsAttention };
  payload.creatives = creatives;
  payload.actions = actions;
  payload.workThisWeek = workThisWeek;
  payload.outcomes = buildOutcomes(previousPayloads[0] ?? null, totals);
  payload.streak = computeStreak(previousPayloads, netReturn, totals.spend);
  payload.benchmark =
    bench && bench.sampleSize >= 20
      ? {
          spendBucket: bench.spendBucket,
          sampleSize: bench.sampleSize,
          percentile,
          label:
            percentile !== null
              ? `Seu ROAS está acima de cerca de ${Math.max(0, percentile - 1)}% dos negócios do seu porte no Automatize.`
              : "Ainda estamos acumulando amostra para comparar com negócios do seu porte.",
        }
      : null;

  const [upserted] = await db
    .insert(clientReportSnapshot)
    .values({
      userId: input.userId,
      periodType: input.periodType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "built",
      headlineState,
      payload,
      monthsPaidBack:
        paidBack.months !== null ? String(paidBack.months) : null,
      isPersonalBest,
      builtAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        clientReportSnapshot.userId,
        clientReportSnapshot.periodType,
        clientReportSnapshot.periodStart,
      ],
      set: {
        periodEnd: input.periodEnd,
        status: "built",
        headlineState,
        payload,
        monthsPaidBack:
          paidBack.months !== null ? String(paidBack.months) : null,
        isPersonalBest,
        builtAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({ id: clientReportSnapshot.id });

  const snapshotId = upserted?.id;
  if (!snapshotId) {
    throw new Error("Failed to persist client report snapshot");
  }

  await seedMissions({
    userId: input.userId,
    snapshotId,
    actions,
  });

  const missions = await db
    .select({
      id: clientReportMission.id,
      title: clientReportMission.title,
      status: clientReportMission.status,
    })
    .from(clientReportMission)
    .where(eq(clientReportMission.snapshotId, snapshotId));
  payload.missions = missions.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
  }));
  await db
    .update(clientReportSnapshot)
    .set({ payload, updatedAt: new Date() })
    .where(eq(clientReportSnapshot.id, snapshotId));

  return {
    snapshotId,
    payload,
    monthsPaidBack: paidBack.months,
    isPersonalBest,
  };
}

async function seedMissions(input: {
  userId: string;
  snapshotId: string;
  actions: ClientReportAction[];
}) {
  const existing = await db
    .select({ id: clientReportMission.id })
    .from(clientReportMission)
    .where(eq(clientReportMission.snapshotId, input.snapshotId))
    .limit(1);
  if (existing.length > 0) return;

  for (const action of input.actions) {
    await db.insert(clientReportMission).values({
      userId: input.userId,
      snapshotId: input.snapshotId,
      title: action.title,
      message: action.message,
      actionPrompt: action.actionPrompt,
      deepLink: action.deepLink,
      status: "suggested",
    });
  }
}
