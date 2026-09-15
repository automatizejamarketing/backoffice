import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeUser,
  crmGoal,
  crmLead,
  crmLeadEvent,
  payment,
  subscription,
  user,
  type CrmCommercialStatus,
} from "@/lib/db/schema";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";
import { brtStartOfCalendarDate } from "@/lib/backoffice/dashboard-date-range";
import {
  CRM_METRIC_META,
  CRM_METRIC_VALUES,
  crmGoalStatus,
  crmMonthCalendarBounds,
  crmRate,
  isCrmMetric,
  isInternalLeadEmail,
  MEETING_DONE_STATUSES,
  resolveCrmGoals,
  SCHEDULED_OR_LATER_STATUSES,
  type CrmGoalRow,
  type CrmGoalStatus,
  type CrmMetric,
} from "@/lib/backoffice/crm-goals";
import type { SalesRole } from "@/lib/auth/rbac-core";

export type CrmGoalMetricView = {
  metric: CrmMetric;
  label: string;
  description: string;
  owner: SalesRole;
  /** Nome de quem tem o cargo hoje, para o card ("SDR · Vinicius"). */
  ownerName: string | null;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  denominatorLabel: string;
  rate: number | null;
  target: number | null;
  status: CrmGoalStatus;
  inherited: boolean;
  sourceMonth: string | null;
  /** Só na conversão real: reuniões que viraram trial e ainda não pagaram. */
  pendingTrial: number | null;
};

export type CrmGoalsDashboard = {
  month: string;
  metrics: CrmGoalMetricView[];
};

/**
 * Agendamento: leads que entraram em "Reunião agendada" (ou depois) no mês,
 * uma vez por lead, sobre contas criadas no mês com telefone e fora da
 * equipe. Trial e cliente: reuniões realizadas no mês cuja conta iniciou
 * acesso / pagou depois da reunião. Modo "fluxo do período"; ver
 * docs/crm-metas.md para a alternativa por coorte.
 */
export async function getCrmGoalsDashboard(month: string): Promise<CrmGoalsDashboard> {
  const bounds = crmMonthCalendarBounds(month);
  const from = brtStartOfCalendarDate(bounds.from);
  const to = brtStartOfCalendarDate(bounds.toExclusive);

  const [team, signups, scheduled, meetings, goalRows] = await Promise.all([
    db
      .select({
        email: backofficeUser.email,
        name: backofficeUser.name,
        salesRole: backofficeUser.salesRole,
        active: backofficeUser.active,
      })
      .from(backofficeUser),
    db
      .select({ email: user.email })
      .from(user)
      .where(
        and(
          gte(user.createdAt, from),
          lt(user.createdAt, to),
          sql`coalesce(${user.phone}, '') <> ''`,
        ),
      ),
    firstStatusEntryInMonth([...SCHEDULED_OR_LATER_STATUSES], from, to),
    firstStatusEntryInMonth([...MEETING_DONE_STATUSES], from, to),
    db
      .select({ month: crmGoal.month, metric: crmGoal.metric, target: crmGoal.target })
      .from(crmGoal)
      .where(lte(crmGoal.month, bounds.from)),
  ]);

  const teamEmails = team.map((member) => member.email);
  const isLead = (email: string) => !isInternalLeadEmail(email, teamEmails);

  const qualifiedSignups = signups.filter((row) => isLead(row.email)).length;
  const scheduledLeads = scheduled.filter((row) => isLead(row.email)).length;
  const meetingLeads = meetings.filter((row) => isLead(row.email));

  const outcomes = await meetingOutcomes(meetingLeads);
  const trials = outcomes.filter((row) => row.trial).length;
  const customers = outcomes.filter((row) => row.customer).length;

  const goals = resolveCrmGoals(
    month,
    goalRows
      .filter((row): row is typeof row & { metric: CrmMetric } => isCrmMetric(row.metric))
      .map(
        (row): CrmGoalRow => ({
          month: String(row.month).slice(0, 7),
          metric: row.metric,
          target: row.target,
        }),
      ),
  );

  const ownerName = (role: SalesRole) =>
    team.find((member) => member.active && member.salesRole === role)?.name ?? null;

  const counts: Record<CrmMetric, { numerator: number; denominator: number }> = {
    agendamento: { numerator: scheduledLeads, denominator: qualifiedSignups },
    conversao_trial: { numerator: trials, denominator: meetingLeads.length },
    conversao_real: { numerator: customers, denominator: meetingLeads.length },
  };

  return {
    month,
    metrics: CRM_METRIC_VALUES.map((metric) => {
      const meta = CRM_METRIC_META[metric];
      const { numerator, denominator } = counts[metric];
      const rate = crmRate(numerator, denominator);
      const goal = goals[metric];
      return {
        metric,
        label: meta.label,
        description: meta.description,
        owner: meta.owner,
        ownerName: ownerName(meta.owner),
        numerator,
        denominator,
        numeratorLabel: meta.numeratorLabel,
        denominatorLabel: meta.denominatorLabel,
        rate,
        target: goal.target,
        status: crmGoalStatus({ rate, target: goal.target }),
        inherited: goal.inherited,
        sourceMonth: goal.sourceMonth,
        pendingTrial: metric === "conversao_real" ? trials - customers : null,
      };
    }),
  };
}

/** Primeira entrada de cada lead em um dos status, dentro do mês. */
async function firstStatusEntryInMonth(statuses: string[], from: Date, to: Date) {
  return db
    .select({
      userId: crmLeadEvent.userId,
      email: user.email,
      at: sql<Date>`min(${crmLeadEvent.createdAt})`.mapWith((value) => new Date(value)),
    })
    .from(crmLeadEvent)
    .innerJoin(user, eq(user.id, crmLeadEvent.userId))
    .where(
      and(
        eq(crmLeadEvent.kind, "status"),
        inArray(crmLeadEvent.statusTo, statuses),
        gte(crmLeadEvent.createdAt, from),
        lt(crmLeadEvent.createdAt, to),
      ),
    )
    .groupBy(crmLeadEvent.userId, user.email);
}

/** Para cada reunião, se a conta iniciou acesso e se pagou depois dela. */
async function meetingOutcomes(
  meetings: Array<{ userId: string; at: Date }>,
): Promise<Array<{ userId: string; trial: boolean; customer: boolean }>> {
  if (meetings.length === 0) return [];
  const userIds = meetings.map((row) => row.userId);

  const [firstSubscriptions, firstPayments] = await Promise.all([
    db
      .select({
        userId: subscription.userId,
        // Coluna naive (UTC): mapWith(coluna) parseia como UTC, não no fuso do processo.
        at: sql<Date>`min(${subscription.createdAt})`.mapWith(subscription.createdAt),
      })
      .from(subscription)
      .where(inArray(subscription.userId, userIds))
      .groupBy(subscription.userId),
    db
      .select({
        userId: payment.userId,
        // Coluna naive (UTC): mapWith(coluna) parseia como UTC, não no fuso do processo.
        at: sql<Date>`min(${payment.createdAt})`.mapWith(payment.createdAt),
      })
      .from(payment)
      .where(
        and(
          inArray(payment.userId, userIds),
          eq(payment.status, "succeeded"),
          billingPaymentPurposeSql(payment.purpose),
        ),
      )
      .groupBy(payment.userId),
  ]);

  const subscriptionAt = new Map(firstSubscriptions.map((row) => [row.userId, row.at]));
  const paymentAt = new Map(firstPayments.map((row) => [row.userId, row.at]));

  return meetings.map((meeting) => {
    const subscribedAt = subscriptionAt.get(meeting.userId);
    const paidAt = paymentAt.get(meeting.userId);
    return {
      userId: meeting.userId,
      trial: !!subscribedAt && subscribedAt.getTime() >= meeting.at.getTime(),
      customer: !!paidAt && paidAt.getTime() >= meeting.at.getTime(),
    };
  });
}

/** Grava as metas do mês (uma linha por métrica). `null` = sem meta a partir do mês. */
export async function saveCrmGoals(input: {
  month: string;
  targets: Partial<Record<CrmMetric, number | null>>;
  updatedBy: string;
}): Promise<void> {
  const monthDate = `${input.month}-01`;
  const entries = Object.entries(input.targets).filter(([metric]) => isCrmMetric(metric));
  if (entries.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [metric, target] of entries) {
      await tx
        .insert(crmGoal)
        .values({
          month: monthDate,
          metric: metric as CrmMetric,
          target: target ?? null,
          updatedBy: input.updatedBy,
        })
        .onConflictDoUpdate({
          target: [crmGoal.month, crmGoal.metric],
          set: { target: target ?? null, updatedBy: input.updatedBy, updatedAt: new Date() },
        });
    }
  });
}

export type CrmGoalLeadRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  companyName: string | null;
  commercialStatus: CrmCommercialStatus;
  createdAt: string | null;
  /** Agendamento ou reunião realizada (primeira entrada no mês). */
  eventAt: string | null;
  /** Entra na base (denominador) da métrica. */
  inDenominator: boolean;
  /** Conta como conversão (numerador). */
  inNumerator: boolean;
};

export type CrmGoalLeads = {
  month: string;
  metric: CrmMetric;
  leads: CrmGoalLeadRow[];
};

/**
 * Quem está por trás do "X de Y" de uma métrica: cada lead com a data do
 * evento e se contou na base e/ou na conversão. Na taxa de agendamento
 * aparecem também os agendados de contas criadas em outro mês (só numerador).
 */
export async function getCrmGoalMetricLeads(
  month: string,
  metric: CrmMetric,
): Promise<CrmGoalLeads> {
  const bounds = crmMonthCalendarBounds(month);
  const from = brtStartOfCalendarDate(bounds.from);
  const to = brtStartOfCalendarDate(bounds.toExclusive);
  const team = await db.select({ email: backofficeUser.email }).from(backofficeUser);
  const teamEmails = team.map((member) => member.email);
  const isLead = (email: string) => !isInternalLeadEmail(email, teamEmails);

  if (metric === "agendamento") {
    const [signups, scheduled] = await Promise.all([
      db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(
          and(
            gte(user.createdAt, from),
            lt(user.createdAt, to),
            sql`coalesce(${user.phone}, '') <> ''`,
          ),
        ),
      firstStatusEntryInMonth([...SCHEDULED_OR_LATER_STATUSES], from, to),
    ]);
    const denominator = new Set(signups.filter((row) => isLead(row.email)).map((row) => row.id));
    const scheduledAt = new Map(
      scheduled.filter((row) => isLead(row.email)).map((row) => [row.userId, row.at]),
    );
    const ids = [...new Set([...denominator, ...scheduledAt.keys()])];
    const profiles = await leadProfiles(ids);
    return {
      month,
      metric,
      leads: profiles
        .map((profile) => ({
          ...profile,
          eventAt: scheduledAt.get(profile.id)?.toISOString() ?? null,
          inDenominator: denominator.has(profile.id),
          inNumerator: scheduledAt.has(profile.id),
        }))
        .sort(sortLeads),
    };
  }

  const meetings = (await firstStatusEntryInMonth([...MEETING_DONE_STATUSES], from, to)).filter(
    (row) => isLead(row.email),
  );
  const outcomes = new Map(
    (await meetingOutcomes(meetings)).map((row) => [row.userId, row]),
  );
  const meetingAt = new Map(meetings.map((row) => [row.userId, row.at]));
  const profiles = await leadProfiles(meetings.map((row) => row.userId));
  return {
    month,
    metric,
    leads: profiles
      .map((profile) => {
        const outcome = outcomes.get(profile.id);
        return {
          ...profile,
          eventAt: meetingAt.get(profile.id)?.toISOString() ?? null,
          inDenominator: true,
          inNumerator:
            metric === "conversao_trial" ? !!outcome?.trial : !!outcome?.customer,
        };
      })
      .sort(sortLeads),
  };
}

function sortLeads(a: CrmGoalLeadRow, b: CrmGoalLeadRow): number {
  if (a.inNumerator !== b.inNumerator) return a.inNumerator ? -1 : 1;
  return (b.eventAt ?? b.createdAt ?? "").localeCompare(a.eventAt ?? a.createdAt ?? "");
}

async function leadProfiles(
  ids: string[],
): Promise<
  Array<
    Pick<
      CrmGoalLeadRow,
      "id" | "name" | "email" | "phone" | "companyName" | "commercialStatus" | "createdAt"
    >
  >
> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      commercialStatus: sql<CrmCommercialStatus>`coalesce(${crmLead.commercialStatus}, 'novo_lead')`,
      companyName: sql<string | null>`(
        select c.name from user_companies uc
        join companies c on c.id = uc.company_id
        where uc.user_id = ${user.id}
        order by (uc.role = 'owner') desc
        limit 1
      )`,
    })
    .from(user)
    .leftJoin(crmLead, eq(crmLead.userId, user.id))
    .where(inArray(user.id, ids));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  }));
}
