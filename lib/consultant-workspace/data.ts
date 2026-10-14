import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { playbookAlertRuleTitle } from "@/lib/backoffice/playbook-alert-dashboard";
import { consultantSeesOnlyAssignedClients, type BackofficeActor } from "@/lib/auth/rbac-core";
import { readWorkspaceState } from "./state";
import { emptyTotals, primaryKpi, workspaceRange } from "./metrics";
import type {
  DailyPoint,
  MetaHealth,
  PerfTotals,
  PlanTier,
  WorkspaceAlert,
  WorkspaceCampaign,
  WorkspaceChangeEvent,
  WorkspaceClient,
  WorkspaceClientDetail,
  WorkspaceRange,
} from "./types";

/**
 * Camada de leitura da área de Tráfego. Tudo vem do banco; nenhuma chamada à
 * Graph API. Performance sai de
 * `meta_tracking_daily_metrics` no nível de campanha — a mesma coleta da tela
 * "Coleta Meta" — somada por cliente.
 */

type Row = Record<string, unknown>;

async function rows<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result as unknown as T[];
}

const num = (value: unknown) => (value == null ? 0 : Number(value));
const iso = (value: unknown) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function tierOf(planType: unknown): PlanTier {
  const value = String(planType ?? "");
  if (value.endsWith("_premium")) return "premium";
  if (value.endsWith("_pro")) return "pro";
  if (value.endsWith("_starter")) return "starter";
  return "sem_plano";
}

function addTotals(target: PerfTotals, row: Row) {
  target.spend += num(row.spend);
  target.impressions += num(row.impressions);
  target.clicks += num(row.clicks);
  target.linkClicks += num(row.link_clicks);
  target.results += num(row.results);
  target.purchases += num(row.purchases);
  target.purchaseValue += num(row.purchase_value);
  target.leads += num(row.leads);
  target.conversations += num(row.conversations);
}

function buildSeries(range: WorkspaceRange, byDate: Map<string, DailyPoint>): DailyPoint[] {
  const points: DailyPoint[] = [];
  const cursor = new Date(`${range.from}T12:00:00Z`);
  const end = new Date(`${range.to}T12:00:00Z`);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    points.push(byDate.get(date) ?? { date, spend: 0, results: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

/** Clientes com acesso válido ou assinatura viva (ativa, trial, inadimplente). */
async function loadActiveClientRows(onlyUserId?: string) {
  const filter = onlyUserId ? sql`and u.id = ${onlyUserId}` : sql``;
  return rows(sql`
    with sub as (
      select distinct on (user_id) user_id, plan_type, status, provider, current_period_end
      from subscriptions
      order by user_id, (status in ('active','trialing','past_due')) desc, current_period_end desc nulls last
    )
    select u.id, u.email, u.name, u.phone, u.expiration_date,
      co.name as company_name,
      sub.plan_type, sub.status as sub_status, sub.provider, sub.current_period_end,
      b.id::text as consultant_id, b.name as consultant_name, b.email as consultant_email,
      mba.connection_status, mba.last_validation_error, mba.name as meta_name,
      cache.ad_account_name, cache.has_active_managed_campaign, cache.checked_at, cache.error_message,
      (select count(*) from meta_publish_holds h where h.user_id = u.id and h.status = 'held')::int as holds
    from users u
    left join sub on sub.user_id = u.id
    left join lateral (
      select c.name from user_companies uc join companies c on c.id = uc.company_id
      where uc.user_id = u.id order by uc.created_at asc limit 1
    ) co on true
    left join user_marketing_consultants umc on umc.user_id = u.id
    left join backoffice_users b on b.id = umc.consultant_id
    left join lateral (
      select connection_status, last_validation_error, name from meta_business_accounts m
      where m.user_id = u.id and m.deleted_at is null
      order by m.updated_at desc limit 1
    ) mba on true
    left join lateral (
      select ad_account_name, has_active_managed_campaign, checked_at, error_message
      from business_managed_campaign_cache bc where bc.user_id = u.id
      order by bc.checked_at desc nulls last limit 1
    ) cache on true
    where (u.expiration_date > now() or sub.status in ('active','trialing','past_due'))
    ${filter}
  `);
}

function metaHealthOf(row: Row): { health: MetaHealth; detail: string | null } {
  if (!row.connection_status) return { health: "sem_meta", detail: null };
  if (row.connection_status !== "active") {
    return { health: "token_invalido", detail: String(row.last_validation_error ?? "Precisa reconectar") };
  }
  if (row.error_message) return { health: "erro_checagem", detail: String(row.error_message) };
  const checkedAt = row.checked_at ? new Date(String(row.checked_at)) : null;
  if (!checkedAt || Date.now() - checkedAt.getTime() > 2 * 86_400_000) {
    return { health: "checagem_velha", detail: checkedAt ? null : "Nunca verificado" };
  }
  return { health: "ok", detail: null };
}

async function loadDailyByUser(userIds: string[], range: WorkspaceRange) {
  if (userIds.length === 0) return [];
  return rows(sql`
    select user_id, metric_date::text as metric_date,
      sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
      sum(link_clicks) as link_clicks, sum(results) as results, sum(purchases) as purchases,
      sum(purchase_value) as purchase_value, sum(leads) as leads,
      sum(messaging_conversations_started) as conversations,
      count(distinct entity_id) filter (where spend > 0) as campaigns_with_spend
    from meta_tracking_daily_metrics
    where entity_level = 'campaign'
      and metric_date >= least(${range.prevFrom}::date, date_trunc('month', ${range.to}::date)::date)
      and metric_date <= ${range.to}::date
      and user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by user_id, metric_date
  `);
}

async function loadOpenAlerts(userIds: string[]): Promise<WorkspaceAlert[]> {
  if (userIds.length === 0) return [];
  const result = await rows(sql`
    select id, user_id, rule_id, severity, title, evidence, recommendation, entity_level,
      entity_id, entity_name, action_type, metrics, created_at
    from performance_insights
    where status in ('open','acknowledged')
      and (snoozed_until is null or snoozed_until <= now())
      and (rule_id like 'playbook.%' or rule_id like 'account.%')
      and user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    order by created_at desc
  `);
  return result.map(toAlert);
}

export function toAlert(row: Row): WorkspaceAlert {
  const ruleId = String(row.rule_id);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ruleId,
    ruleTitle: playbookAlertRuleTitle(ruleId),
    family: ruleId.startsWith("account.") ? "account" : "playbook",
    severity: (["critical", "warning", "info"].includes(String(row.severity))
      ? row.severity
      : "info") as WorkspaceAlert["severity"],
    title: String(row.title ?? ""),
    evidence: String(row.evidence ?? ""),
    recommendation: String(row.recommendation ?? ""),
    entityLevel: String(row.entity_level ?? ""),
    entityId: String(row.entity_id ?? ""),
    entityName: row.entity_name ? String(row.entity_name) : null,
    actionType: String(row.action_type ?? ""),
    metrics: (row.metrics ?? {}) as Record<string, unknown>,
    createdAt: iso(row.created_at) ?? "",
  };
}

async function loadLastTouch(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const ids = sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await rows(sql`
    select user_id, max(at) as at from (
      select user_id, reviewed_at as at from performance_insights
        where reviewed_by_email is not null and user_id in (${ids})
      union all
      select target_user_id as user_id, created_at as at from backoffice_audit_logs
        where target_user_id in (${ids})
      union all
      select user_id, occurred_at as at from meta_tracking_change_events
        where source = 'backoffice_admin' and user_id in (${ids})
      union all
      select user_id, created_at as at from consultant_client_notes
        where user_id in (${ids}) and kind <> 'sinal'
    ) t group by user_id
  `);
  return new Map(result.map((row) => [String(row.user_id), iso(row.at) ?? ""]));
}

/**
 * Cache curto da leitura pesada (carteira inteira): as métricas vão só até
 * ontem, então 2 minutos não mudam nada para o consultor — e várias abas abrindo
 * páginas ao mesmo tempo esgotariam as 3 conexões do banco. O que o consultor
 * trata (alertas, notas) vem do estado lido na hora, não do cache.
 * Consultas simultâneas para o mesmo período compartilham a mesma promessa.
 */
const PORTFOLIO_CACHE_TTL_MS = 2 * 60 * 1000;
type PortfolioLoad = {
  baseRows: Row[];
  daily: Row[];
  alerts: WorkspaceAlert[];
  lastTouch: Map<string, string>;
};
const portfolioCache = new Map<string, { at: number; promise: Promise<PortfolioLoad> }>();

function loadPortfolio(range: WorkspaceRange): Promise<PortfolioLoad> {
  const key = `${range.from}:${range.to}`;
  const cached = portfolioCache.get(key);
  if (cached && Date.now() - cached.at < PORTFOLIO_CACHE_TTL_MS) return cached.promise;
  const promise = (async () => {
    const baseRows = await loadActiveClientRows();
    const userIds = baseRows.map((row) => String(row.id));
    const [daily, alerts, lastTouch] = await Promise.all([
      loadDailyByUser(userIds, range),
      loadOpenAlerts(userIds),
      loadLastTouch(userIds),
    ]);
    return { baseRows, daily, alerts, lastTouch };
  })();
  portfolioCache.set(key, { at: Date.now(), promise });
  promise.catch(() => portfolioCache.delete(key));
  return promise;
}

/** O consultor comum só enxerga a carteira atribuída; premium, dev e admin veem todos. */
function visibleTo(actor: BackofficeActor, userId: string) {
  return !consultantSeesOnlyAssignedClients(actor.role) || (actor.assignedUserIds ?? []).includes(userId);
}

export async function getWorkspaceClients(
  actor: BackofficeActor,
  options: { days?: number; onlyUserId?: string } = {},
): Promise<{ range: WorkspaceRange; clients: WorkspaceClient[]; alerts: WorkspaceAlert[] }> {
  const range = workspaceRange(options.days ?? 7);
  const [load, store] = await Promise.all([loadPortfolio(range), readWorkspaceState()]);
  const only = options.onlyUserId;
  const baseRows = load.baseRows.filter(
    (row) => (!only || String(row.id) === only) && visibleTo(actor, String(row.id)),
  );
  const visibleIds = new Set(baseRows.map((row) => String(row.id)));
  const daily = load.daily.filter((row) => visibleIds.has(String(row.user_id)));
  const alerts = load.alerts.filter((alert) => visibleIds.has(alert.userId));
  const lastTouch = load.lastTouch;

  const monthStart = `${range.to.slice(0, 7)}-01`;
  const recentFrom = shiftDate(range.to, -1);
  const perfByUser = new Map<
    string,
    { current: PerfTotals; previous: PerfTotals; byDate: Map<string, DailyPoint>; mtd: number; active: number }
  >();
  for (const row of daily) {
    const userId = String(row.user_id);
    let entry = perfByUser.get(userId);
    if (!entry) {
      entry = { current: emptyTotals(), previous: emptyTotals(), byDate: new Map(), mtd: 0, active: 0 };
      perfByUser.set(userId, entry);
    }
    const date = String(row.metric_date);
    if (date >= range.from && date <= range.to) {
      addTotals(entry.current, row);
      entry.byDate.set(date, { date, spend: num(row.spend), results: num(row.results) });
    } else if (date >= range.prevFrom && date <= range.prevTo) {
      addTotals(entry.previous, row);
    }
    if (date >= monthStart && date <= range.to) entry.mtd += num(row.spend);
    if (date >= recentFrom) entry.active = Math.max(entry.active, num(row.campaigns_with_spend));
  }

  // Alertas tratados ou adiados depois do cache saem da contagem na hora.
  const now = Date.now();
  const liveAlerts = alerts.filter((alert) => {
    const action = store.alertActions[alert.id];
    if (!action) return true;
    if (action.status === "snoozed") {
      return !!action.snoozeUntil && new Date(action.snoozeUntil).getTime() <= now;
    }
    return false;
  });
  const alertsByUser = new Map<string, WorkspaceAlert[]>();
  for (const alert of liveAlerts) {
    const list = alertsByUser.get(alert.userId) ?? [];
    list.push(alert);
    alertsByUser.set(alert.userId, list);
  }

  const notesTouch = new Map<string, string>();
  for (const note of store.notes) {
    if (!notesTouch.has(note.userId)) notesTouch.set(note.userId, note.createdAt);
  }

  const clients: WorkspaceClient[] = baseRows.map((row) => {
    const userId = String(row.id);
    const perf = perfByUser.get(userId);
    const current = perf?.current ?? emptyTotals();
    const previous = perf?.previous ?? emptyTotals();
    const kind = primaryKpi(addAll(current, previous)).kind;
    const userAlerts = alertsByUser.get(userId) ?? [];
    const consultantKey = (row.consultant_id as string | null) ?? null;
    const meta = metaHealthOf(row);
    const touches = [lastTouch.get(userId), notesTouch.get(userId)].filter(Boolean) as string[];
    const companyName = (row.company_name as string | null)?.trim() || null;
    const name = (row.name as string | null)?.trim() || null;
    return {
      userId,
      email: String(row.email),
      name,
      companyName,
      displayName: companyName ?? name ?? String(row.email),
      phone: (row.phone as string | null) ?? null,
      plan: {
        tier: tierOf(row.plan_type),
        period: row.plan_type ? String(row.plan_type).split("_")[0] : null,
        status: (row.sub_status as string | null) ?? null,
        provider: (row.provider as string | null) ?? null,
        renewalAt: iso(row.current_period_end),
      },
      accessUntil: iso(row.expiration_date),
      consultant: {
        key: consultantKey,
        name: (row.consultant_name as string | null) ?? (row.consultant_email as string | null) ?? null,
        email: (row.consultant_email as string | null) ?? null,
      },
      meta: {
        ...meta,
        accountName: (row.ad_account_name as string | null) ?? (row.meta_name as string | null) ?? null,
        hasActiveManagedCampaign: Boolean(row.has_active_managed_campaign),
        checkedAt: iso(row.checked_at),
      },
      publishHolds: num(row.holds),
      perf: {
        current,
        previous,
        kpi: primaryKpi(current, kind),
        previousKpi: primaryKpi(previous, kind),
        series: buildSeries(range, perf?.byDate ?? new Map()),
        monthToDateSpend: perf?.mtd ?? 0,
        activeCampaigns: perf?.active ?? 0,
      },
      alerts: {
        open: userAlerts.length,
        critical: userAlerts.filter((alert) => alert.severity === "critical").length,
        warning: userAlerts.filter((alert) => alert.severity === "warning").length,
        info: userAlerts.filter((alert) => alert.severity === "info").length,
        oldestOpenAt: userAlerts.length
          ? userAlerts.reduce((oldest, alert) => (alert.createdAt < oldest ? alert.createdAt : oldest), userAlerts[0].createdAt)
          : null,
      },
      lastConsultantTouchAt: touches.length ? touches.sort().at(-1)! : null,
    };
  });

  return { range, clients, alerts: liveAlerts };
}

function addAll(a: PerfTotals, b: PerfTotals): PerfTotals {
  const total = emptyTotals();
  for (const key of Object.keys(total) as (keyof PerfTotals)[]) total[key] = a[key] + b[key];
  return total;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function getWorkspaceClientDetail(
  actor: BackofficeActor,
  userId: string,
  days = 7,
): Promise<WorkspaceClientDetail | null> {
  const { range, clients, alerts } = await getWorkspaceClients(actor, { days, onlyUserId: userId });
  const client = clients[0];
  if (!client) return null;

  const [metricRows, configRows, changeRows, closedRows] = await Promise.all([
    rows(sql`
      select entity_id as campaign_id, account_id, metric_date::text as metric_date,
        spend, impressions, clicks, link_clicks, results, purchases, purchase_value, leads,
        messaging_conversations_started as conversations
      from meta_tracking_daily_metrics
      where user_id = ${userId}::uuid and entity_level = 'campaign'
        and metric_date between ${range.prevFrom}::date and ${range.to}::date
    `),
    rows(sql`
      select distinct on (entity_id) entity_id, account_id, entity_name, configured_status,
        effective_status, objective, daily_budget, lifetime_budget, is_managed
      from meta_tracking_config_versions
      where user_id = ${userId}::uuid and entity_level = 'campaign'
      order by entity_id, (valid_to is null) desc, valid_from desc
    `),
    rows(sql`
      select id, occurred_at, entity_level, entity_name, change_kind, source,
        coalesce(actor_email, actor_name_meta) as actor, note, changed_fields
      from meta_tracking_change_events
      where user_id = ${userId}::uuid and occurred_at > now() - interval '30 days'
        and not (change_kind = 'created' and entity_level = 'ad')
      order by occurred_at desc
      limit 150
    `),
    rows(sql`
      select id, user_id, rule_id, severity, title, evidence, recommendation, entity_level,
        entity_id, entity_name, action_type, metrics, created_at, status,
        reviewed_by_email, review_note, coalesce(reviewed_at, updated_at) as reviewed_at
      from performance_insights
      where user_id = ${userId}::uuid and status in ('done','dismissed','resolved')
        and (rule_id like 'playbook.%' or rule_id like 'account.%')
        and coalesce(reviewed_at, updated_at) > now() - interval '30 days'
      order by coalesce(reviewed_at, updated_at) desc
      limit 40
    `),
  ]);

  const configById = new Map(configRows.map((row) => [String(row.entity_id), row]));
  const campaigns = new Map<
    string,
    { accountId: string; current: PerfTotals; previous: PerfTotals; byDate: Map<string, DailyPoint> }
  >();
  for (const row of metricRows) {
    const id = String(row.campaign_id);
    let entry = campaigns.get(id);
    if (!entry) {
      entry = { accountId: String(row.account_id), current: emptyTotals(), previous: emptyTotals(), byDate: new Map() };
      campaigns.set(id, entry);
    }
    const date = String(row.metric_date);
    if (date >= range.from) {
      addTotals(entry.current, row);
      entry.byDate.set(date, { date, spend: num(row.spend), results: num(row.results) });
    } else if (date <= range.prevTo) {
      addTotals(entry.previous, row);
    }
  }

  const campaignList: WorkspaceCampaign[] = [...campaigns.entries()]
    .map(([campaignId, entry]) => {
      const config = configById.get(campaignId);
      const kind = primaryKpi(addAll(entry.current, entry.previous)).kind;
      return {
        campaignId,
        accountId: entry.accountId,
        name: String(config?.entity_name ?? campaignId),
        status: (config?.configured_status as string | null) ?? null,
        effectiveStatus: (config?.effective_status as string | null) ?? null,
        objective: (config?.objective as string | null) ?? null,
        dailyBudget: config?.daily_budget != null ? Number(config.daily_budget) / 100 : null,
        lifetimeBudget: config?.lifetime_budget != null ? Number(config.lifetime_budget) / 100 : null,
        isManaged: Boolean(config?.is_managed),
        current: entry.current,
        previous: entry.previous,
        kpi: primaryKpi(entry.current, kind),
        previousKpi: primaryKpi(entry.previous, kind),
        series: buildSeries(range, entry.byDate),
      };
    })
    .sort((a, b) => b.current.spend - a.current.spend);

  const changes: WorkspaceChangeEvent[] = changeRows.map((row) => ({
    id: String(row.id),
    occurredAt: iso(row.occurred_at) ?? "",
    entityLevel: String(row.entity_level),
    entityName: (row.entity_name as string | null) ?? null,
    changeKind: String(row.change_kind),
    source: String(row.source),
    actor: (row.actor as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    changedFields: (row.changed_fields ?? {}) as Record<string, unknown>,
  }));

  return {
    client,
    campaigns: campaignList,
    changes,
    alerts,
    recentlyClosedAlerts: closedRows.map((row) => ({
      ...toAlert(row),
      status: String(row.status),
      reviewedBy: (row.reviewed_by_email as string | null) ?? null,
      reviewNote: (row.review_note as string | null) ?? null,
      reviewedAt: iso(row.reviewed_at),
    })),
  };
}
