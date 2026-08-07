import {
  formatBrtCalendarDate,
  shiftCalendarDate,
} from "./dashboard-date-range";

export const WHATSAPP_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
] as const;

export type WhatsappDeliveryStatus =
  (typeof WHATSAPP_DELIVERY_STATUSES)[number];

export type WhatsappHistoryRawFilters = {
  from?: string | string[];
  to?: string | string[];
  q?: string | string[];
  template?: string | string[];
  status?: string | string[];
  page?: string | string[];
};

export type WhatsappHistoryFilters = {
  fromDate: string;
  throughDate: string;
  gte: Date;
  lt: Date;
  query: string;
  template: string | null;
  status: WhatsappDeliveryStatus | null;
  page: number;
  pageSize: 50;
};

export type WhatsappDeliveryMetricRow = {
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  historicalStatusUntracked: boolean;
};

export type WhatsappTemplateHistorySummary = {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  historicalUntracked: number;
};

export const WHATSAPP_STATUS_LABELS: Record<
  WhatsappDeliveryStatus,
  string
> = {
  queued: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  failed: "Falhou",
  deleted: "Excluído",
};

const TEMPLATE_LABELS: Record<string, string> = {
  signup_nudge_15m_v2: "Ativação pré-trial · 15 min",
  signup_nudge_1d_v2: "Ativação pré-trial · 1 dia",
  trial_onboarding_nudge_30m_v1: "Onboarding do trial · 30 min",
  pix_renovacao_v2: "Renovação PIX",
  pix_pagamento_confirmado_v1: "Pagamento PIX confirmado",
};

const SOURCE_LABELS: Record<string, string> = {
  onboarding_notification: "Ativação",
  billing_notification: "Cobrança PIX",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function saoPauloStartOfDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 3));
}

export function normalizeWhatsappHistoryFilters(
  raw: WhatsappHistoryRawFilters,
  now: Date = new Date(),
): WhatsappHistoryFilters {
  const today = formatBrtCalendarDate(now);
  const requestedFrom = first(raw.from);
  const requestedTo = first(raw.to);
  const customDatesValid =
    isCalendarDate(requestedFrom) &&
    isCalendarDate(requestedTo) &&
    requestedFrom <= requestedTo &&
    requestedTo <= today;
  const fromDate = customDatesValid
    ? requestedFrom
    : shiftCalendarDate(today, -6);
  const throughDate = customDatesValid ? requestedTo : today;
  const rawStatus = first(raw.status);
  const status = WHATSAPP_DELIVERY_STATUSES.includes(
    rawStatus as WhatsappDeliveryStatus,
  )
    ? (rawStatus as WhatsappDeliveryStatus)
    : null;
  const rawPage = Number(first(raw.page));
  const template = first(raw.template)?.trim().slice(0, 255) || null;

  return {
    fromDate,
    throughDate,
    gte: saoPauloStartOfDay(fromDate),
    lt: saoPauloStartOfDay(shiftCalendarDate(throughDate, 1)),
    query: first(raw.q)?.trim().slice(0, 200) ?? "",
    template,
    status,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: 50,
  };
}

export function summarizeWhatsappDeliveryRows(
  rows: WhatsappDeliveryMetricRow[],
): WhatsappTemplateHistorySummary {
  return rows.reduce<WhatsappTemplateHistorySummary>(
    (summary, row) => ({
      sent: summary.sent + (row.acceptedAt ? 1 : 0),
      delivered:
        summary.delivered + (row.deliveredAt || row.readAt ? 1 : 0),
      read: summary.read + (row.readAt ? 1 : 0),
      failed: summary.failed + (row.failedAt ? 1 : 0),
      historicalUntracked:
        summary.historicalUntracked +
        (row.historicalStatusUntracked ? 1 : 0),
    }),
    { sent: 0, delivered: 0, read: 0, failed: 0, historicalUntracked: 0 },
  );
}

export function getWhatsappTemplateLabel(templateName: string): string {
  return TEMPLATE_LABELS[templateName] ?? templateName;
}

export function getWhatsappSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
