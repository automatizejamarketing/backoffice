import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  CRM_COMMERCIAL_STATUS_VALUES,
  crmContactEvent as crmLeadEvent,
  crmContact as contact,
  user as account,
  type CrmCommercialStatus,
} from "@/lib/db/schema";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";
import {
  brtStartOfCalendarDate,
  shiftCalendarDate,
} from "@/lib/backoffice/dashboard-date-range";
import {
  deriveAccountStage,
  type CrmAccountStage,
  type CrmDateBounds,
  type CrmKanbanColumn,
  type CrmLeadEventView,
  type CrmLeadSummary,
} from "@/lib/backoffice/crm";

const accountExpirationSql = sql<Date | null>`(select expiration_date from users where id = ${contact.userId})`;

const commercialStatusSql = sql<CrmCommercialStatus>`coalesce(${contact.commercialStatus}, 'novo_lead')`;

/** Ordem do funil: quem mudou de status por último aparece primeiro. */
const recencySql = sql`coalesce(${contact.statusChangedAt}, ${contact.createdAt})`;

const hasApprovedPaymentSql = sql<boolean>`exists (
  select 1 from payments p
  where p.user_id = ${contact.userId}
    and p.status = 'succeeded'
    and ${billingPaymentPurposeSql()}
)`;

/** Status da última assinatura registrada para o usuário (null se nunca teve). */
const lastSubscriptionStatusSql = sql<string | null>`(
  select s.status from subscriptions s
  where s.user_id = ${contact.userId}
  order by s.created_at desc limit 1
)`;

const ambassadorAccessSql = sql<boolean>`exists(select 1 from ambassador_benefits b where b.user_id = ${contact.userId} and b.expires_on >= (now() at time zone 'America/Sao_Paulo')::date) and not exists(select 1 from subscriptions s where s.user_id = ${contact.userId} and s.status in ('active','past_due','trialing'))`;
const ambassadorOnlySql = sql<boolean>`exists(select 1 from ambassador_benefits b where b.user_id = ${contact.userId}) and not exists(select 1 from subscriptions s where s.user_id = ${contact.userId}) and not ${hasApprovedPaymentSql}`;
const leadColumns = {
  ambassadorAccess: ambassadorAccessSql,
  ambassadorOnly: ambassadorOnlySql,
  id: contact.id,
  userId: contact.userId,
  captureSource: contact.captureSource,
  captureProfile: contact.captureProfile,
  revenueRange: contact.revenueRange,
  objective: contact.objective,
  email: contact.email,
  name: contact.name,
  phone: contact.phone,
  createdAt: contact.createdAt,
  expirationDate: accountExpirationSql,
  companyName: sql<string | null>`(
    select c.name from user_companies uc
    join companies c on c.id = uc.company_id
    where uc.user_id = ${contact.userId}
    order by (uc.role = 'owner') desc
    limit 1
  )`,
  consultantName: sql<string | null>`(
    select coalesce(bu.name, bu.email) from user_marketing_consultants umc
    join backoffice_users bu on bu.id = umc.consultant_id
    where umc.user_id = ${contact.userId}
  )`,
  hasApprovedPayment: hasApprovedPaymentSql,
  subscriptionStatus: lastSubscriptionStatusSql,
  commercialStatus: commercialStatusSql,
  statusChangedAt: contact.statusChangedAt,
  statusChangedBy: contact.statusChangedBy,
  // json_agg em vez de array_agg: o driver devolve json já como array JS.
  productTitles: sql<string[]>`(
    select coalesce(json_agg(distinct po.product_title_snapshot), '[]'::json)
    from product_orders po
    where po.status = 'approved'
      and (po.user_id = ${contact.userId} or po.buyer_email = ${contact.email})
  )`,
  lastNoteBody: sql<string | null>`(
    select e.body from crm_contact_events e
    where e.contact_id = ${contact.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
  lastNoteAt: sql<string | null>`(
    select e.created_at::text from crm_contact_events e
    where e.contact_id = ${contact.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
  lastNoteAuthor: sql<string | null>`(
    select e.author_email from crm_contact_events e
    where e.contact_id = ${contact.id} and e.kind = 'note'
    order by e.created_at desc limit 1
  )`,
};

type LeadRow = {
  ambassadorAccess: boolean;
  ambassadorOnly: boolean;
  id: string;
  userId: string | null;
  captureSource: string | null;
  captureProfile: string | null;
  revenueRange: string | null;
  objective: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  createdAt: Date | null;
  expirationDate: Date | null;
  companyName: string | null;
  consultantName: string | null;
  hasApprovedPayment: boolean;
  subscriptionStatus: string | null;
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
    userId: row.userId,
    captureSource: row.captureSource,
    captureProfile: row.captureProfile,
    revenueRange: row.revenueRange,
    objective: row.objective,
    email: row.email,
    name: row.name,
    phone: row.phone,
    companyName: row.companyName,
    consultantName: row.consultantName,
    createdAt: toIso(row.createdAt),
    expirationDate: toIso(row.expirationDate),
    hasApprovedPayment: row.hasApprovedPayment,
    accountStage: row.userId ? deriveAccountStage(row, now) : "sem_conta",
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

/** Espelho SQL de deriveAccountStage; os dois precisam mudar juntos. */
function accountStageCondition(stage: CrmAccountStage): SQL {
  if (stage === "cortesia") return ambassadorAccessSql;
  const hasAccessDate = sql`${accountExpirationSql} is not null`;
  const active = sql`${accountExpirationSql} > now()`;
  const expired = sql`${accountExpirationSql} <= now()`;
  const canceled = sql`${lastSubscriptionStatusSql} = 'canceled'`;
  const notCanceled = sql`coalesce(${lastSubscriptionStatusSql}, '') <> 'canceled'`;
  const passedTrial = sql`coalesce(${lastSubscriptionStatusSql}, 'trialing') <> 'trialing'`;
  switch (stage) {
    case "sem_conta":
      return sql`${contact.userId} is null`;
    case "sem_trial":
      return sql`${contact.userId} is not null and ${accountExpirationSql} is null`;
    case "cancelado":
      return sql`not (${ambassadorAccessSql}) and ${hasAccessDate} and ${canceled}`;
    case "trial_ativo":
      return sql`not (${ambassadorAccessSql}) and not (${ambassadorOnlySql}) and ${active} and ${notCanceled} and not ${hasApprovedPaymentSql}`;
    case "assinante_ativo":
      return sql`not (${ambassadorAccessSql}) and ${active} and ${notCanceled} and ${hasApprovedPaymentSql}`;
    case "expirado":
      return sql`not (${ambassadorAccessSql}) and ((${ambassadorOnlySql}) or (${expired} and ${notCanceled} and (${hasApprovedPaymentSql} or ${passedTrial})))`;
    case "trial_vencido":
      return sql`not (${ambassadorAccessSql}) and not (${ambassadorOnlySql}) and ${expired} and ${notCanceled} and not ${hasApprovedPaymentSql} and not ${passedTrial}`;
  }
}

type CrmLeadFilters = {
  captureSource?: string;
  captureProfile?: string;
  search?: string;
  commercialStatus?: CrmCommercialStatus;
  accountStage?: CrmAccountStage;
  /** Data do cadastro, dias de calendário BRT, inclusivo; qualquer ponta pode faltar. */
  signup?: CrmDateBounds;
  /** Data de expiração do acesso, dias de calendário BRT, inclusivo; qualquer ponta pode faltar. */
  expires?: CrmDateBounds;
};

function dateBoundsCondition(
  column: AnyPgColumn | SQL,
  bounds: CrmDateBounds,
): SQL | undefined {
  const parts: SQL[] = [];
  if (bounds.from)
    parts.push(
      sql`${column} >= ${brtStartOfCalendarDate(bounds.from).toISOString()}`,
    );
  if (bounds.to) {
    parts.push(
      sql`${column} < ${brtStartOfCalendarDate(shiftCalendarDate(bounds.to, 1)).toISOString()}`,
    );
  }
  return parts.length > 0 ? and(...parts) : undefined;
}

function buildConditions(input: CrmLeadFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (input.captureSource)
    conditions.push(eq(contact.captureSource, input.captureSource));
  if (input.captureProfile)
    conditions.push(eq(contact.captureProfile, input.captureProfile));
  const search = input.search?.trim() ?? "";
  if (search.length >= 3) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(contact.name, pattern),
        ilike(contact.email, pattern),
        ilike(contact.phone, pattern),
        sql`exists(select 1 from user_companies uc join companies c on c.id = uc.company_id where uc.user_id = ${contact.userId} and c.name ilike ${pattern})`,
      )!,
    );
  }
  if (input.commercialStatus) {
    conditions.push(sql`${commercialStatusSql} = ${input.commercialStatus}`);
  }
  if (input.accountStage) {
    conditions.push(accountStageCondition(input.accountStage));
  }
  const signup =
    input.signup && dateBoundsCondition(contact.createdAt, input.signup);
  if (signup) conditions.push(signup);
  const expires =
    input.expires && dateBoundsCondition(accountExpirationSql, input.expires);
  if (expires) conditions.push(expires);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listCrmLeads(
  input: CrmLeadFilters & {
    page: number;
    pageSize: number;
  },
): Promise<{
  leads: CrmLeadSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where = buildConditions(input);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const now = new Date();

  const [{ total: rawTotal }] = await db
    .select({ total: count() })
    .from(contact)
    .where(where);
  const total = Number(rawTotal);
  // Página pedida além do fim (filtro mudou, lead saiu) cai na última.
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(lastPage, Math.max(1, input.page));

  const rows = await db
    .select(leadColumns)
    .from(contact)
    .leftJoin(account, eq(account.id, contact.userId))
    .where(where)
    .orderBy(desc(recencySql), desc(contact.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    leads: rows.map((row) => toSummary(row, now)),
    total,
    page,
    pageSize,
  };
}

export async function listCrmKanban(
  input: Omit<CrmLeadFilters, "commercialStatus"> & {
    perColumn?: number;
  },
): Promise<CrmKanbanColumn[]> {
  const where = buildConditions(input);
  const perColumn = Math.min(100, Math.max(1, input.perColumn ?? 40));
  const now = new Date();

  const [counts, ...columns] = await Promise.all([
    db
      .select({ status: commercialStatusSql, total: count() })
      .from(contact)
      .where(where)
      .groupBy(commercialStatusSql),
    ...CRM_COMMERCIAL_STATUS_VALUES.map((status) =>
      db
        .select(leadColumns)
        .from(contact)
        .leftJoin(account, eq(account.id, contact.userId))
        .where(and(where, sql`${commercialStatusSql} = ${status}`))
        .orderBy(desc(recencySql), desc(contact.id))
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
  const [resolved] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(or(eq(contact.id, userId), eq(contact.userId, userId)))
    .limit(1);
  if (!resolved) return null;
  userId = resolved.id;
  const [rows, events] = await Promise.all([
    db
      .select(leadColumns)
      .from(contact)
      .leftJoin(account, eq(account.id, contact.userId))
      .where(eq(contact.id, userId))
      .limit(1),
    db
      .select()
      .from(crmLeadEvent)
      .where(eq(crmLeadEvent.contactId, userId))
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
  const contactId = await resolveContactId(input.userId);
  input = { ...input, userId: contactId };
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: commercialStatusSql })
      .from(contact)
      .where(eq(contact.id, input.userId))
      .limit(1)
      .for("update");
    if (!current) throw new Error("Contato não encontrado");
    if (current.status === input.status) {
      return { changed: false, from: current.status };
    }
    const now = new Date();
    await tx
      .update(contact)
      .set({
        commercialStatus: input.status,
        statusChangedAt: now,
        statusChangedBy: input.authorEmail,
        updatedAt: now,
      })
      .where(eq(contact.id, input.userId));
    await tx.insert(crmLeadEvent).values({
      contactId: input.userId,
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
  input = { ...input, userId: await resolveContactId(input.userId) };
  const [event] = await db
    .insert(crmLeadEvent)
    .values({
      contactId: input.userId,
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

async function resolveContactId(id: string) {
  const [resolved] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(or(eq(contact.id, id), eq(contact.userId, id)))
    .limit(1);
  if (!resolved) throw new Error("Contato não encontrado");
  return resolved.id;
}
