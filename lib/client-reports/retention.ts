import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Retention cohort: users who received ≥1 report vs everyone else,
 * measured by whether expiration_date is still in the future at 30/60/90d
 * after first delivered report (or after first tracking day for control).
 */
export async function queryReportRetentionCohort() {
  const rows = await db.execute(sql`
    with delivered as (
      select
        user_id,
        min(delivered_at) as first_delivered_at
      from client_report_snapshots
      where delivered_at is not null
      group by user_id
    ),
    cohort as (
      select
        u.id as user_id,
        d.first_delivered_at,
        u.expiration_date,
        case when d.user_id is null then 'control' else 'received' end as cohort
      from users u
      left join delivered d on d.user_id = u.id
    )
    select
      cohort,
      count(*)::int as users,
      count(*) filter (
        where expiration_date > first_delivered_at + interval '30 days'
          or (first_delivered_at is null and expiration_date > now() + interval '30 days')
      )::int as retained_30d,
      count(*) filter (
        where expiration_date > first_delivered_at + interval '60 days'
          or (first_delivered_at is null and expiration_date > now() + interval '60 days')
      )::int as retained_60d,
      count(*) filter (
        where expiration_date > first_delivered_at + interval '90 days'
          or (first_delivered_at is null and expiration_date > now() + interval '90 days')
      )::int as retained_90d
    from cohort
    group by cohort
    order by cohort
  `);

  return rows as unknown as Array<{
    cohort: string;
    users: number;
    retained_30d: number;
    retained_60d: number;
    retained_90d: number;
  }>;
}
