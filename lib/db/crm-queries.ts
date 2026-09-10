import { and, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  CRM_COMMERCIAL_STATUS_VALUES,
  crmLead,
  crmLeadEvent,
  user,
  type CrmCommercialStatus,
} from "@/lib/db/schema";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";
import { buildUserListSearchCondition } from "@/lib/backoffice/user-search";
import {
  brtStartOfCalendarDate,
  shiftCalendarDate,
} from "@/lib/backoffice/dashboard-date-range";
import {
  deriveAccountStage,
  type CrmAccountStage,
  type CrmDateRange,
  type CrmKanbanColumn,
  type CrmLeadEventView,
  type CrmLeadSummary,
} from "@/lib/backoffice/crm";

const commercialStatusSql = sql<CrmCommercialStatus>`coalesce(${crmLead.commercialStatus}, 'novo_lead')`;

/** Ordem do funil: quem mudou de status por último aparece primeiro. */
const recencySql = sql`coalesce(${crmLead.statusChangedAt}, ${user.createdAt})`;

const hasApprovedPaymentSql = sql<boolean>`exists (
  select 1 from payments p
  where p.user_id = ${user.id}
    and p.status = 'succeeded'
    and ${billingPaymentPurposeSql()}
)`;

const leadColumns = {
  id: user.id,
  email: user.email,
  name: user.name,
  phone: user.phone,
  createdAt: user.createdAt,
  expirationDate: user.expirationDate,
  companyName: sql<string | null>`(
    select c.name from user_companies uc
    join companies c on c.id = uc.company_id
    where uc.user_id = ${user.id}
    order by (uc.role = 'owner') desc
    limit 1
  )`,
  consultantName: sql<string | null>`(
    select coalesce(bu.name, bu.email) from user_marketing_consultants umc
    join backoffice_users bu on bu.id = umc.consultant_id
    where umc.user_id = ${user.id}
  )`,
  hasApprovedPayment: hasApprovedPaymentSql,
  commercialStatus: commercialStatusSql,
  statusChangedAt: crmLead.statusChangedAt,
  statusChangedBy: crmLead.statusChangedBy,
  // json_agg em vez de array_agg: o driver devolve json já como array JS.
  productTitles: sql<string[]>`(
    select coalesce(json_agg(distinct po.product_title_snapshot), '[]'::json)
    from product_orders po
    where po.status = 'approved'
      and (po.user_id = ${user.id} or po.buyer_email = ${user.email})
  )`,
  lastNoteBody: sql<string | null>`(
    select e.body from crm_lead_events e
    where e.user_id = ${user.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
  lastNoteAt: sql<string | null>`(
    select e.created_at::text from crm_lead_events e
    where e.user_id = ${user.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
  lastNoteAuthor: sql<string | null>`(
    select e.author_email from crm_lead_events e
    where e.user_id = ${user.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
};

type LeadRow = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  createdAt: Date | null;
  expirationDate: Date | null;
  companyName: string | null;
  consultantName: string | null;
  hasApprovedPayment: boolean;
  commercialStatus: CrmCommercialStatus;
  statusChangedAt: Date | null;
  statusChangedBy: string | null;
  productTitles: string[];
  lastNoteBody: string | null;
  lastNoteAt: string | null;
  lastNoteAuthor: string | null;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSummary(row: LeadRow, now: Date): CrmLeadSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    companyName: row.companyName,
    consultantName: row.consultantName,
    createdAt: toIso(row.createdAt),
    expirationDate: toIso(row.expirationDate),
    hasApprovedPayment: row.hasApprovedPayment,
    accountStage: deriveAccountStage(row, now),
    commercialStatus: row.commercialStatus,
    statusChangedAt: toIso(row.statusChangedAt) ?? toIso(row.createdAt),
    statusChangedBy: row.statusChangedBy,
    productTitles: Array.isArray(row.productTitles) ? row.productTitles : [],
    lastNote:
      row.lastNoteBody && row.lastNoteAt && row.lastNoteAuthor
        ? {
            body: row.lastNoteBody,
            createdAt: toIso(row.lastNoteAt) ?? row.lastNoteAt,
            authorEmail: row.lastNoteAuthor,
          }
        : null,
  };
}

function accountStageCondition(stage: CrmAccountStage): SQL {
  const active = sql`${user.expirationDate} > now()`;
  const expired = sql`${user.expirationDate} <= now()`;
  switch (stage) {
    case "sem_trial":
      return sql`${user.expirationDate} is null`;
    case "trial_ativo":
      return sql`${active} and not ${hasApprovedPaymentSql}`;
    case "trial_vencido":
      return sql`${expired} and not ${hasApprovedPaymentSql}`;
    case "assinante_ativo":
      return sql`${active} and ${hasApprovedPaymentSql}`;
    case "assinante_vencido":
      return sql`${expired} and ${hasApprovedPaymentSql}`;
  }
}

type CrmLeadFilters = {
  search?: string;
  commercialStatus?: CrmCommercialStatus;
  accountStage?: CrmAccountStage;
  /** Data do cadastro, dias de calendário BRT, inclusivo. */
  signup?: CrmDateRange;
  /** Data de expiração do acesso, dias de calendário BRT, inclusivo. */
  expires?: CrmDateRange;
};

function dateRangeCondition(column: AnyPgColumn, range: CrmDateRange): SQL {
  const from = brtStartOfCalendarDate(range.from);
  const to = brtStartOfCalendarDate(shiftCalendarDate(range.to, 1));
  return and(gte(column, from), lt(column, to))!;
}

function buildConditions(input: CrmLeadFilters): SQL | undefined {
  const conditions: SQL[] = [];
  const search = input.search?.trim() ?? "";
  if (search.length >= 3) {
    const condition = buildUserListSearchCondition(search);
    if (condition) conditions.push(condition);
  }
  if (input.commercialStatus) {
    conditions.push(sql`${commercialStatusSql} = ${input.commercialStatus}`);
  }
  if (input.accountStage) {
    conditions.push(accountStageCondition(input.accountStage));
  }
  if (input.signup) {
    conditions.push(dateRangeCondition(user.createdAt, input.signup));
  }
  if (input.expires) {
    conditions.push(dateRangeCondition(user.expirationDate, input.expires));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listCrmLeads(input: CrmLeadFilters & {
  page: number;
  pageSize: number;
}): Promise<{ leads: CrmLeadSummary[]; total: number; page: number; pageSize: number }> {
  const where = buildConditions(input);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const now = new Date();

  const [{ total: rawTotal }] = await db
    .select({ total: count() })
    .from(user)
    .leftJoin(crmLead, eq(crmLead.userId, user.id))
    .where(where);
  const total = Number(rawTotal);
  // Página pedida além do fim (filtro mudou, lead saiu) cai na última.
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(lastPage, Math.max(1, input.page));

  const rows = await db
    .select(leadColumns)
    .from(user)
    .leftJoin(crmLead, eq(crmLead.userId, user.id))
    .where(where)
    .orderBy(desc(recencySql), desc(user.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    leads: rows.map((row) => toSummary(row, now)),
    total,
    page,
    pageSize,
  };
}

export async function listCrmKanban(input: Omit<CrmLeadFilters, "commercialStatus"> & {
  perColumn?: number;
}): Promise<CrmKanbanColumn[]> {
  const where = buildConditions(input);
  const perColumn = Math.min(100, Math.max(1, input.perColumn ?? 40));
  const now = new Date();

  const [counts, ...columns] = await Promise.all([
    db
      .select({ status: commercialStatusSql, total: count() })
      .from(user)
      .leftJoin(crmLead, eq(crmLead.userId, user.id))
      .where(where)
      .groupBy(commercialStatusSql),
    ...CRM_COMMERCIAL_STATUS_VALUES.map((status) =>
      db
        .select(leadColumns)
        .from(user)
        .leftJoin(crmLead, eq(crmLead.userId, user.id))
        .where(and(where, sql`${commercialStatusSql} = ${status}`))
        .orderBy(desc(recencySql), desc(user.id))
        .limit(perColumn),
    ),
  ]);

  const totalByStatus = new Map(
    counts.map((row) => [row.status, Number(row.total)]),
  );
  return CRM_COMMERCIAL_STATUS_VALUES.map((status, index) => ({
    status,
    total: totalByStatus.get(status) ?? 0,
    leads: columns[index].map((row) => toSummary(row, now)),
  }));
}

export async function getCrmLead(userId: string): Promise<{
  lead: CrmLeadSummary;
  events: CrmLeadEventView[];
} | null> {
  const [rows, events] = await Promise.all([
    db
      .select(leadColumns)
      .from(user)
      .leftJoin(crmLead, eq(crmLead.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1),
    db
      .select()
      .from(crmLeadEvent)
      .where(eq(crmLeadEvent.userId, userId))
      .orderBy(desc(crmLeadEvent.createdAt))
      .limit(200),
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    lead: toSummary(row, new Date()),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      body: event.body,
      statusFrom: (event.statusFrom as CrmCommercialStatus | null) ?? null,
      statusTo: (event.statusTo as CrmCommercialStatus | null) ?? null,
      authorEmail: event.authorEmail,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Troca o status e registra a troca na linha do tempo. Mesmo status é no-op. */
export async function setCrmLeadStatus(input: {
  userId: string;
  status: CrmCommercialStatus;
  authorEmail: string;
}): Promise<{ changed: boolean; from: CrmCommercialStatus }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: commercialStatusSql })
      .from(user)
      .leftJoin(crmLead, eq(crmLead.userId, user.id))
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!current) throw new Error("Usuário não encontrado");
    if (current.status === input.status) {
      return { changed: false, from: current.status };
    }
    const now = new Date();
    await tx
      .insert(crmLead)
      .values({
        userId: input.userId,
        commercialStatus: input.status,
        statusChangedAt: now,
        statusChangedBy: input.authorEmail,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: crmLead.userId,
        set: {
          commercialStatus: input.status,
          statusChangedAt: now,
          statusChangedBy: input.authorEmail,
          updatedAt: now,
        },
      });
    await tx.insert(crmLeadEvent).values({
      userId: input.userId,
      kind: "status",
      statusFrom: current.status,
      statusTo: input.status,
      authorEmail: input.authorEmail,
      createdAt: now,
    });
    return { changed: true, from: current.status };
  });
}

export async function addCrmLeadNote(input: {
  userId: string;
  body: string;
  authorEmail: string;
}): Promise<CrmLeadEventView> {
  const [event] = await db
    .insert(crmLeadEvent)
    .values({
      userId: input.userId,
      kind: "note",
      body: input.body,
      authorEmail: input.authorEmail,
    })
    .returning();
  return {
    id: event.id,
    kind: "note",
    body: event.body,
    statusFrom: null,
    statusTo: null,
    authorEmail: event.authorEmail,
    createdAt: event.createdAt.toISOString(),
  };
}
