import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  like,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import {
  comparePlaybookAlertMetric,
  emptyPlaybookAlertKpis,
  fillDailyPlaybookAlertSeries,
  mostCommonRule,
  playbookAlertRuleTitle,
  previousEquivalentWindow,
  resolvePlaybookAlertAccessScope,
  statusesForPlaybookAlertTab,
  treatmentRate,
  type PlaybookAlertFilters,
  type PlaybookAlertKpis,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { buildUserListSearchCondition } from "@/lib/backoffice/user-search";
import { db } from "@/lib/db";
import {
  backofficeUser,
  performanceInsight,
  user,
  userMarketingConsultant,
} from "@/lib/db/schema";
import { PLAYBOOK_INSIGHTS_RULE_PREFIX } from "@/lib/playbook-insights/constants";

const completedAtExpr = sql<Date>`
  CASE
    WHEN ${performanceInsight.status} = 'resolved' THEN ${performanceInsight.updatedAt}
    ELSE COALESCE(${performanceInsight.reviewedAt}, ${performanceInsight.updatedAt})
  END
`;

const createdDateExpr = sql<string>`(timezone('America/Sao_Paulo', ${performanceInsight.createdAt}))::date::text`;
const completedDateExpr = sql<string>`(timezone('America/Sao_Paulo', ${completedAtExpr}))::date::text`;

function completedAtInWindow(window: { gte: Date; lt: Date }): SQL {
  return and(
    sql`(${completedAtExpr}) >= ${window.gte.toISOString()}`,
    sql`(${completedAtExpr}) < ${window.lt.toISOString()}`,
  )!;
}

function playbookRuleCondition() {
  return like(performanceInsight.ruleId, `${PLAYBOOK_INSIGHTS_RULE_PREFIX}%`);
}

function accessConditions(actor: BackofficeActor): SQL[] {
  const scope = resolvePlaybookAlertAccessScope(actor);
  if (scope.kind === "consultant") {
    return [eq(userMarketingConsultant.consultantId, scope.consultantId)];
  }
  return [];
}

function attributeConditions(
  filters: Pick<PlaybookAlertFilters, "search" | "ruleId" | "severity">,
): SQL[] {
  const conditions: SQL[] = [playbookRuleCondition()];

  if (filters.ruleId !== "all") {
    conditions.push(eq(performanceInsight.ruleId, filters.ruleId));
  }
  if (filters.severity !== "all") {
    conditions.push(eq(performanceInsight.severity, filters.severity));
  }

  const search = filters.search.trim();
  if (search.length > 0) {
    conditions.push(
      or(
        buildUserListSearchCondition(search),
        ilike(performanceInsight.entityName, `%${search}%`),
        ilike(performanceInsight.title, `%${search}%`),
      )!,
    );
  }

  return conditions;
}

function whereDashboard(
  actor: BackofficeActor,
  filters: Pick<PlaybookAlertFilters, "search" | "ruleId" | "severity">,
  extra: SQL[] = [],
) {
  const conditions = [
    ...accessConditions(actor),
    ...attributeConditions(filters),
    ...extra,
  ];
  return conditions.length > 0 ? and(...conditions) : undefined;
}

const companyNameExpr = sql<string | null>`(
  SELECT c.name
  FROM user_companies uc
  INNER JOIN companies c ON c.id = uc.company_id
  WHERE uc.user_id = ${user.id}
  ORDER BY uc.created_at ASC
  LIMIT 1
)`;

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asMetrics(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function loadPeriodKpis(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
  window: PlaybookAlertFilters["window"],
): Promise<PlaybookAlertKpis & { completedOfCreated: number }> {
  const [createdRow] = await db
    .select({
      created: sql<number>`count(*)::int`,
      completedOfCreated: sql<number>`count(*) FILTER (
        WHERE ${performanceInsight.status} IN ('done', 'dismissed', 'resolved')
      )::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        gte(performanceInsight.createdAt, window.gte),
        lt(performanceInsight.createdAt, window.lt),
      ]),
    );

  const [completedRow] = await db
    .select({
      completed: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        inArray(performanceInsight.status, ["done", "dismissed", "resolved"]),
        completedAtInWindow(window),
      ]),
    );

  const created = asNumber(createdRow?.created);
  const completedOfCreated = asNumber(createdRow?.completedOfCreated);

  return {
    created,
    completed: asNumber(completedRow?.completed),
    completedOfCreated,
    treatmentRate: treatmentRate(created, completedOfCreated),
  };
}

async function loadTypeBreakdown(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
) {
  const rows = await db
    .select({
      ruleId: performanceInsight.ruleId,
      count: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        gte(performanceInsight.createdAt, filters.window.gte),
        lt(performanceInsight.createdAt, filters.window.lt),
      ]),
    )
    .groupBy(performanceInsight.ruleId)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    ruleId: row.ruleId,
    title: playbookAlertRuleTitle(row.ruleId),
    count: asNumber(row.count),
  }));
}

async function loadDailySeries(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
) {
  const createdRows = await db
    .select({
      date: createdDateExpr,
      created: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        gte(performanceInsight.createdAt, filters.window.gte),
        lt(performanceInsight.createdAt, filters.window.lt),
      ]),
    )
    .groupBy(createdDateExpr);

  const completedRows = await db
    .select({
      date: completedDateExpr,
      completed: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        inArray(performanceInsight.status, ["done", "dismissed", "resolved"]),
        completedAtInWindow(filters.window),
      ]),
    )
    .groupBy(completedDateExpr);

  const createdByDate = new Map(
    createdRows.map((row) => [String(row.date), asNumber(row.created)]),
  );
  const completedByDate = new Map(
    completedRows.map((row) => [String(row.date), asNumber(row.completed)]),
  );
  const dates = new Set([...createdByDate.keys(), ...completedByDate.keys()]);

  return fillDailyPlaybookAlertSeries(
    [...dates].map((date) => ({
      date,
      created: createdByDate.get(date) ?? 0,
      completed: completedByDate.get(date) ?? 0,
    })),
    filters.window,
  );
}

async function countCurrentPending(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(
      whereDashboard(actor, filters, [
        inArray(performanceInsight.status, ["open", "acknowledged"]),
      ]),
    );

  return asNumber(row?.count);
}

export type PlaybookAlertDashboardRow = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  companyName: string | null;
  consultantId: string | null;
  consultantEmail: string | null;
  consultantName: string | null;
  ruleId: string;
  ruleTitle: string;
  severity: string;
  status: string;
  title: string;
  evidence: string;
  recommendation: string;
  entityLevel: string;
  entityId: string;
  entityName: string | null;
  metrics: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  reviewedByEmail: string | null;
  completedAt: Date | null;
};

async function listDashboardRows(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
): Promise<{ rows: PlaybookAlertDashboardRow[]; total: number }> {
  const statuses = statusesForPlaybookAlertTab(filters.tab, filters.status);
  const extra: SQL[] =
    filters.tab === "pending"
      ? [inArray(performanceInsight.status, [...statuses])]
      : [
          inArray(performanceInsight.status, [...statuses]),
          completedAtInWindow(filters.window),
        ];

  const where = whereDashboard(actor, filters, extra);
  const orderBy =
    filters.tab === "pending"
      ? [desc(performanceInsight.createdAt), desc(performanceInsight.id)]
      : [desc(completedAtExpr), desc(performanceInsight.id)];

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .where(where);

  const total = asNumber(countRow?.total);
  if (total === 0) return { rows: [], total };

  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select({
      id: performanceInsight.id,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      companyName: companyNameExpr,
      consultantId: backofficeUser.id,
      consultantEmail: backofficeUser.email,
      consultantName: backofficeUser.name,
      ruleId: performanceInsight.ruleId,
      severity: performanceInsight.severity,
      status: performanceInsight.status,
      title: performanceInsight.title,
      evidence: performanceInsight.evidence,
      recommendation: performanceInsight.recommendation,
      entityLevel: performanceInsight.entityLevel,
      entityId: performanceInsight.entityId,
      entityName: performanceInsight.entityName,
      metrics: performanceInsight.metrics,
      createdAt: performanceInsight.createdAt,
      updatedAt: performanceInsight.updatedAt,
      reviewedAt: performanceInsight.reviewedAt,
      reviewedByEmail: performanceInsight.reviewedByEmail,
      completedAt: completedAtExpr,
    })
    .from(performanceInsight)
    .innerJoin(user, eq(user.id, performanceInsight.userId))
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .leftJoin(
      backofficeUser,
      eq(backofficeUser.id, userMarketingConsultant.consultantId),
    )
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  return {
    total,
    rows: rows.map((row) => ({
      ...row,
      companyName: row.companyName ?? null,
      consultantId: row.consultantId ?? null,
      consultantEmail: row.consultantEmail ?? null,
      consultantName: row.consultantName ?? null,
      ruleTitle: playbookAlertRuleTitle(row.ruleId),
      metrics: asMetrics(row.metrics),
      createdAt: asDate(row.createdAt) ?? new Date(0),
      updatedAt: asDate(row.updatedAt) ?? new Date(0),
      reviewedAt: asDate(row.reviewedAt),
      completedAt: asDate(row.completedAt),
    })),
  };
}

export async function getPlaybookAlertDashboard(
  actor: BackofficeActor,
  filters: PlaybookAlertFilters,
) {
  const previousWindow = previousEquivalentWindow(filters.window);

  const [current, previous, types, series, pendingNow, table] =
    await Promise.all([
      loadPeriodKpis(actor, filters, filters.window),
      loadPeriodKpis(actor, filters, previousWindow),
      loadTypeBreakdown(actor, filters),
      loadDailySeries(actor, filters),
      countCurrentPending(actor, filters),
      listDashboardRows(actor, filters),
    ]);

  const currentKpis = current ?? emptyPlaybookAlertKpis();
  const previousKpis = previous ?? emptyPlaybookAlertKpis();

  return {
    window: filters.window,
    previousWindow,
    kpis: {
      created: comparePlaybookAlertMetric(currentKpis.created, previousKpis.created),
      completed: comparePlaybookAlertMetric(
        currentKpis.completed,
        previousKpis.completed,
      ),
      pendingNow,
      treatmentRate: currentKpis.treatmentRate,
      previousTreatmentRate: previousKpis.treatmentRate,
      mostCommon: mostCommonRule(types),
    },
    types,
    series,
    table,
  };
}

export type PlaybookAlertDashboard = Awaited<
  ReturnType<typeof getPlaybookAlertDashboard>
>;
