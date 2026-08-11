import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  WhatsappClickKind,
  WhatsappDeliveryStatus,
  WhatsappHistoryFilters,
  WhatsappTemplateHistorySummary,
} from "@/lib/backoffice/whatsapp-history-model";
import { db } from "./index";
import {
  user,
  whatsappTemplateClickEvent,
  whatsappTemplateDelivery,
} from "./schema";

export type WhatsappTemplateHistoryItem = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  templateName: string;
  source: string;
  currentStatus: WhatsappDeliveryStatus;
  currentStatusAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  clickedAt: Date | null;
  clickKind: WhatsappClickKind | null;
  failedAt: Date | null;
  deletedAt: Date | null;
  failureCode: string | null;
  failureDetail: string | null;
  historicalStatusUntracked: boolean;
  createdAt: Date;
};

function selectHistoryItem() {
  return {
    id: whatsappTemplateDelivery.id,
    userId: whatsappTemplateDelivery.userId,
    userName: user.name,
    userEmail: user.email,
    templateName: whatsappTemplateDelivery.templateName,
    source: whatsappTemplateDelivery.source,
    currentStatus: whatsappTemplateDelivery.currentStatus,
    currentStatusAt: whatsappTemplateDelivery.currentStatusAt,
    acceptedAt: whatsappTemplateDelivery.acceptedAt,
    deliveredAt: whatsappTemplateDelivery.deliveredAt,
    readAt: whatsappTemplateDelivery.readAt,
    clickedAt: whatsappTemplateDelivery.clickedAt,
    clickKind: sql<WhatsappClickKind | null>`(
      select ${whatsappTemplateClickEvent.kind}
      from ${whatsappTemplateClickEvent}
      where ${whatsappTemplateClickEvent.deliveryId} = ${whatsappTemplateDelivery.id}
      order by ${whatsappTemplateClickEvent.clickedAt} asc
      limit 1
    )`,
    failedAt: whatsappTemplateDelivery.failedAt,
    deletedAt: whatsappTemplateDelivery.deletedAt,
    failureCode: whatsappTemplateDelivery.failureCode,
    failureDetail: whatsappTemplateDelivery.failureDetail,
    historicalStatusUntracked:
      whatsappTemplateDelivery.historicalStatusUntracked,
    createdAt: whatsappTemplateDelivery.createdAt,
  };
}

function filterConditions(filters: WhatsappHistoryFilters): SQL[] {
  const conditions: SQL[] = [
    gte(whatsappTemplateDelivery.createdAt, filters.gte),
    lt(whatsappTemplateDelivery.createdAt, filters.lt),
  ];
  if (filters.template) {
    conditions.push(
      eq(whatsappTemplateDelivery.templateName, filters.template),
    );
  }
  if (filters.status) {
    conditions.push(eq(whatsappTemplateDelivery.currentStatus, filters.status));
  }
  if (filters.query) {
    const query = `%${filters.query}%`;
    conditions.push(or(ilike(user.email, query), ilike(user.name, query))!);
  }
  return conditions;
}

export async function getWhatsappTemplateHistory(
  filters: WhatsappHistoryFilters,
): Promise<{
  items: WhatsappTemplateHistoryItem[];
  total: number;
  summary: WhatsappTemplateHistorySummary;
  templates: string[];
}> {
  const where = and(...filterConditions(filters));
  const offset = (filters.page - 1) * filters.pageSize;

  const [items, totalRows, summaryRows, templateRows] = await Promise.all([
    db
      .select(selectHistoryItem())
      .from(whatsappTemplateDelivery)
      .innerJoin(user, eq(user.id, whatsappTemplateDelivery.userId))
      .where(where)
      .orderBy(desc(whatsappTemplateDelivery.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(whatsappTemplateDelivery)
      .innerJoin(user, eq(user.id, whatsappTemplateDelivery.userId))
      .where(where),
    db
      .select({
        sent: sql<number>`count(*) filter (where ${whatsappTemplateDelivery.acceptedAt} is not null)`.mapWith(
          Number,
        ),
        delivered:
          sql<number>`count(*) filter (where ${whatsappTemplateDelivery.deliveredAt} is not null or ${whatsappTemplateDelivery.readAt} is not null)`.mapWith(
            Number,
          ),
        read: sql<number>`count(*) filter (where ${whatsappTemplateDelivery.readAt} is not null)`.mapWith(
          Number,
        ),
        clicked:
          sql<number>`count(*) filter (where ${whatsappTemplateDelivery.clickedAt} is not null)`.mapWith(
            Number,
          ),
        failed:
          sql<number>`count(*) filter (where ${whatsappTemplateDelivery.failedAt} is not null)`.mapWith(
            Number,
          ),
        historicalUntracked:
          sql<number>`count(*) filter (where ${whatsappTemplateDelivery.historicalStatusUntracked} = true)`.mapWith(
            Number,
          ),
      })
      .from(whatsappTemplateDelivery)
      .innerJoin(user, eq(user.id, whatsappTemplateDelivery.userId))
      .where(where),
    db
      .selectDistinct({ templateName: whatsappTemplateDelivery.templateName })
      .from(whatsappTemplateDelivery)
      .orderBy(whatsappTemplateDelivery.templateName),
  ]);

  return {
    items,
    total: totalRows[0]?.total ?? 0,
    summary: summaryRows[0] ?? {
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      failed: 0,
      historicalUntracked: 0,
    },
    templates: templateRows.map((row) => row.templateName),
  };
}

export async function getUserWhatsappTemplateHistory(
  userId: string,
): Promise<WhatsappTemplateHistoryItem[]> {
  return db
    .select(selectHistoryItem())
    .from(whatsappTemplateDelivery)
    .innerJoin(user, eq(user.id, whatsappTemplateDelivery.userId))
    .where(eq(whatsappTemplateDelivery.userId, userId))
    .orderBy(desc(whatsappTemplateDelivery.createdAt));
}
