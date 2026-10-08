import "server-only";

import { and, between, desc, eq, inArray, isNull, like, ne, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { consultantSeesOnlyAssignedClients, type BackofficeActor } from "@/lib/auth/rbac-core";
import { PLAYBOOK_PENDING_STATUSES } from "@/lib/backoffice/playbook-alert-dashboard";
import { db } from "@/lib/db";
import {
  backofficeUser, businessManagedCampaignCache, metaBusinessAccount, metaTrackingAccountCoverage,
  metaTrackingDailyMetric, performanceInsight, user, userMarketingConsultant,
} from "@/lib/db/schema";
import type { Period, WindowTotals } from "./meta-ads-metrics";

/**
 * Whose clients a call may read. A plain consultant is pinned to their own portfolio; everyone
 * else with marketing:read sees all clients, and only an admin may narrow to one consultant —
 * the same split as the /portfolio screen.
 */
export async function resolveConsultantScope(actor: BackofficeActor, consultantEmail?: string): Promise<string | null> {
  if (consultantSeesOnlyAssignedClients(actor.role)) return actor.id;
  if (!consultantEmail) return null;
  if (actor.role !== "admin") throw new Error("Só admin filtra por consultor.");
  const [row] = await db.select({ id: backofficeUser.id }).from(backofficeUser).where(eq(backofficeUser.email, consultantEmail.trim().toLowerCase())).limit(1);
  if (!row) throw new Error(`Consultor ${consultantEmail} não encontrado.`);
  return row.id;
}

function inScope(userIdColumn: AnyPgColumn, consultantId: string | null): SQL | undefined {
  if (!consultantId) return undefined;
  return sql`${userIdColumn} IN (SELECT ${userMarketingConsultant.userId} FROM ${userMarketingConsultant} WHERE ${userMarketingConsultant.consultantId} = ${consultantId})`;
}

const num = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function windowSums(p: Period) {
  const m = metaTrackingDailyMetric;
  const inWindow = sql`${m.metricDate} BETWEEN ${p.since} AND ${p.until}`;
  return {
    spend: sql<string>`COALESCE(SUM(${m.spend}) FILTER (WHERE ${inWindow}), 0)`,
    results: sql<string>`COALESCE(SUM(${m.results}) FILTER (WHERE ${inWindow}), 0)`,
    purchases: sql<string>`COALESCE(SUM(${m.purchases}) FILTER (WHERE ${inWindow}), 0)`,
    revenue: sql<string>`COALESCE(SUM(${m.purchaseValue}) FILTER (WHERE ${inWindow}), 0)`,
    leads: sql<string>`COALESCE(SUM(${m.leads}) FILTER (WHERE ${inWindow}), 0)`,
    conversations: sql<string>`COALESCE(SUM(${m.messagingConversationsStarted}) FILTER (WHERE ${inWindow}), 0)`,
    impressions: sql<string>`COALESCE(SUM(${m.impressions}) FILTER (WHERE ${inWindow}), 0)`,
    linkClicks: sql<string>`COALESCE(SUM(${m.linkClicks}) FILTER (WHERE ${inWindow}), 0)`,
    campaignsWithSpend: sql<string>`COUNT(DISTINCT ${m.entityId}) FILTER (WHERE ${inWindow} AND ${m.spend} > 0)`,
  };
}

function toWindow(row: Record<keyof WindowTotals, unknown>): WindowTotals {
  return {
    spend: num(row.spend), results: num(row.results), purchases: num(row.purchases), revenue: num(row.revenue),
    leads: num(row.leads), conversations: num(row.conversations), impressions: num(row.impressions),
    linkClicks: num(row.linkClicks), campaignsWithSpend: num(row.campaignsWithSpend),
  };
}

/**
 * Both windows for every client with campaign data, from the daily warehouse the
 * meta-tracking cron fills (meta_tracking_daily_metrics). One grouped query, no Meta call:
 * campaign-level rows only, so ad sets and ads are never counted twice.
 */
export async function loadPortfolioWindows(args: { consultantId: string | null; current: Period; previous: Period; userIds?: string[] }) {
  const m = metaTrackingDailyMetric;
  const cur = windowSums(args.current);
  const prev = windowSums(args.previous);
  const rows = await db
    .select({
      userId: m.userId,
      accounts: sql<string>`COUNT(DISTINCT ${m.accountId})`,
      ...Object.fromEntries(Object.entries(cur).map(([k, v]) => [`cur_${k}`, v])),
      ...Object.fromEntries(Object.entries(prev).map(([k, v]) => [`prev_${k}`, v])),
    } as Record<string, SQL | typeof m.userId>)
    .from(m)
    .where(and(
      eq(m.entityLevel, "campaign"),
      between(m.metricDate, args.previous.since, args.current.until),
      inScope(m.userId, args.consultantId),
      args.userIds ? inArray(m.userId, args.userIds) : undefined,
    ))
    .groupBy(m.userId);

  return rows.map(row => {
    const pick = (prefix: string) => Object.fromEntries(Object.keys(cur).map(k => [k, (row as Record<string, unknown>)[`${prefix}_${k}`]])) as Record<keyof WindowTotals, unknown>;
    return { userId: String(row.userId), accounts: num(row.accounts), current: toWindow(pick("cur")), previous: toWindow(pick("prev")) };
  });
}

/** Clients in scope with a live Meta connection: the denominator for "who is not spending". */
export async function loadScopedMetaClientIds(consultantId: string | null, userIds?: string[]): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: metaBusinessAccount.userId })
    .from(metaBusinessAccount)
    .where(and(isNull(metaBusinessAccount.deletedAt), inScope(metaBusinessAccount.userId, consultantId), userIds ? inArray(metaBusinessAccount.userId, userIds) : undefined));
  return rows.map(r => r.userId);
}

const companyNameExpr = sql<string | null>`(
  SELECT c.name FROM user_companies uc INNER JOIN companies c ON c.id = uc.company_id
  WHERE uc.user_id = ${user.id} ORDER BY uc.created_at ASC LIMIT 1
)`;

export type ClientLabel = { client: string; email: string; consultant: string | null };

/** Display name (company, else name, else e-mail) and consultant for each client. */
export async function loadClientLabels(userIds: string[]): Promise<Map<string, ClientLabel>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, email: user.email, name: user.name, companyName: companyNameExpr, consultantName: backofficeUser.name, consultantEmail: backofficeUser.email })
    .from(user)
    .leftJoin(userMarketingConsultant, eq(userMarketingConsultant.userId, user.id))
    .leftJoin(backofficeUser, eq(backofficeUser.id, userMarketingConsultant.consultantId))
    .where(inArray(user.id, userIds));
  return new Map(rows.map(r => [r.id, {
    client: r.companyName?.trim() || r.name?.trim() || r.email,
    email: r.email,
    consultant: r.consultantName?.trim() || r.consultantEmail || null,
  }]));
}

export type ClientCollection = { currency: string | null; issue: string | null };

/**
 * Latest collection outcome per client: the account currency and, when any account was not
 * collected on its last run (expired connection, failure), why — its numbers may be stale.
 */
export async function loadCollectionStatus(userIds: string[]): Promise<Map<string, ClientCollection>> {
  if (userIds.length === 0) return new Map();
  const c = metaTrackingAccountCoverage;
  const rows = await db
    .selectDistinctOn([c.userId, c.accountId], { userId: c.userId, status: c.status, currency: c.currency })
    .from(c)
    .where(inArray(c.userId, userIds))
    .orderBy(c.userId, c.accountId, desc(c.businessDate), desc(c.createdAt));
  const byUser = new Map<string, ClientCollection>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? { currency: null, issue: null };
    entry.currency = entry.currency ?? row.currency;
    if (row.status !== "complete") entry.issue = entry.issue ?? row.status;
    byUser.set(row.userId, entry);
  }
  return byUser;
}

/** Spend per client in one window, for the portfolio list. */
export async function loadSpendByUser(userIds: string[], period: Period): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const m = metaTrackingDailyMetric;
  const rows = await db
    .select({ userId: m.userId, spend: sql<string>`COALESCE(SUM(${m.spend}), 0)` })
    .from(m)
    .where(and(eq(m.entityLevel, "campaign"), inArray(m.userId, userIds), between(m.metricDate, period.since, period.until)))
    .groupBy(m.userId);
  return new Map(rows.map(r => [r.userId, num(r.spend)]));
}

const META_CHECK_PLACEHOLDER = "__meta_check__";

/** Ad accounts seen by the last managed-campaign check (cron, twice a day). */
export async function loadAdAccountsByUser(userIds: string[]): Promise<Map<string, { id: string; name: string | null }[]>> {
  if (userIds.length === 0) return new Map();
  const c = businessManagedCampaignCache;
  const rows = await db
    .select({ userId: c.userId, id: c.adAccountId, name: c.adAccountName })
    .from(c)
    .where(and(inArray(c.userId, userIds), ne(c.adAccountId, META_CHECK_PLACEHOLDER)));
  const byUser = new Map<string, { id: string; name: string | null }[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), { id: row.id, name: row.name }]);
  return byUser;
}

export const ALERT_FAMILIES = { playbook: "playbook.", drop: "drop.", account: "account." } as const;
export type AlertFamily = keyof typeof ALERT_FAMILIES;

const SEVERITY_RANK = sql`CASE ${performanceInsight.severity} WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`;

/** Pending alerts (open or in progress) the crons left for clients in scope, worst first. */
export async function listPendingAlerts(args: { consultantId: string | null; family?: AlertFamily; severity?: string; userId?: string; limit: number }) {
  const pi = performanceInsight;
  const where = and(
    inArray(pi.status, [...PLAYBOOK_PENDING_STATUSES]),
    inScope(pi.userId, args.consultantId),
    args.family ? like(pi.ruleId, `${ALERT_FAMILIES[args.family]}%`) : undefined,
    args.severity ? eq(pi.severity, args.severity) : undefined,
    args.userId ? eq(pi.userId, args.userId) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db.select({
      id: pi.id, userId: pi.userId, ruleId: pi.ruleId, severity: pi.severity, status: pi.status, title: pi.title,
      evidence: pi.evidence, recommendation: pi.recommendation, entityLevel: pi.entityLevel, entityId: pi.entityId,
      entityName: pi.entityName, createdAt: pi.createdAt,
    }).from(pi).where(where).orderBy(SEVERITY_RANK, desc(pi.createdAt)).limit(args.limit),
    db.select({ total: sql<string>`COUNT(*)` }).from(pi).where(where),
  ]);
  return { rows, total: num(count?.total) };
}
