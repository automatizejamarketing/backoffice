import "server-only";
import { sql } from "drizzle-orm";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { isCoreSegment } from "@/lib/consultant-workspace/access";
import { getWorkspaceClients } from "@/lib/consultant-workspace/data";
import { getJourneyExtras } from "@/lib/consultant-workspace/journey-data";
import { getTouchedAlertUsers, readStateFor } from "@/components/consultant-workspace/common/server-data";
import { slimAlert, type BoardData, type StoppedSpend } from "./lib";

export type { BoardData, StoppedSpend };

/** Leituras da Jornada, dos Playbooks e das Mensagens (somente SELECT). */

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  return Array.from((await db.execute(query)) as unknown as Row[]);
}

/** Para quem não gastou no período: quanto rodava por semana antes de parar. */
export async function getStoppedSpend(userIds: string[]): Promise<Record<string, StoppedSpend>> {
  if (userIds.length === 0) return {};
  const ids = sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await rows(sql`
    with last as (
      select user_id, max(metric_date) as last_date
      from meta_tracking_daily_metrics
      where entity_level = 'campaign' and spend > 0 and user_id in (${ids})
      group by user_id
    )
    select m.user_id::text as user_id, l.last_date::text as last_date, sum(m.spend) as week_spend
    from meta_tracking_daily_metrics m
    join last l on l.user_id = m.user_id
    where m.entity_level = 'campaign'
      and m.metric_date between l.last_date - 6 and l.last_date
    group by m.user_id, l.last_date
  `);
  const map: Record<string, StoppedSpend> = {};
  for (const row of result) {
    map[String(row.user_id)] = {
      lastSpendDate: String(row.last_date),
      weekSpend: Number(row.week_spend ?? 0),
    };
  }
  return map;
}

/**
 * Base do quadro, da biblioteca de playbooks e das contagens por tag. A etapa
 * é sempre medida em 7 dias.
 */
export async function getBoardData(actor: BackofficeActor): Promise<BoardData> {
  const [workspace, store] = await Promise.all([getWorkspaceClients(actor, { days: 7 }), readStateFor(actor)]);
  // Mesmo universo do "Todos ativos" da Fila/Mesa: os pagantes em dia.
  const { range } = workspace;
  const clients = workspace.clients.filter((client) => isCoreSegment(client.access));
  const coreIds = new Set(clients.map((client) => client.userId));
  const alerts = workspace.alerts.filter((alert) => coreIds.has(alert.userId));
  const userIds = clients.map((client) => client.userId);
  const idle = clients.filter((client) => client.perf.current.spend === 0).map((client) => client.userId);
  const [extras, stopped, touchedAlertUser] = await Promise.all([
    getJourneyExtras(userIds),
    getStoppedSpend(idle),
    getTouchedAlertUsers(store, new Set(alerts.map((alert) => alert.id)), new Set(userIds)),
  ]);
  return { range, clients, alerts: alerts.map(slimAlert), extras, stopped, store, touchedAlertUser };
}

/** Nome de exibição para o histórico de mensagens (empresa > nome > e-mail). */
export async function getClientNames(userIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return {};
  const ids = sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await rows(sql`
    select u.id::text as user_id, coalesce(nullif(trim(co.name), ''), nullif(trim(u.name), ''), u.email) as display_name
    from users u
    left join lateral (
      select c.name from user_companies uc join companies c on c.id = uc.company_id
      where uc.user_id = u.id order by uc.created_at asc limit 1
    ) co on true
    where u.id in (${ids})
  `);
  return Object.fromEntries(result.map((row) => [String(row.user_id), String(row.display_name)]));
}
