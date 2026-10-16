export type WhatsappTemplateDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "deleted";

export type WhatsappTemplateStatusEventInput = {
  eventKey: string;
  providerMessageId: string;
  status: Exclude<WhatsappTemplateDeliveryStatus, "queued">;
  providerStatusAt: Date;
  failureCode: string | null;
  failureDetail: string | null;
};

export type WhatsappTemplateDeliveryState = {
  currentStatus: WhatsappTemplateDeliveryStatus;
  currentStatusAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  deletedAt: Date | null;
  failureCode: string | null;
  failureDetail: string | null;
};

const PROVIDER_STATUSES = new Set<
  Exclude<WhatsappTemplateDeliveryStatus, "queued">
>(["sent", "delivered", "read", "failed", "deleted"]);

const STATUS_PRECEDENCE: Record<WhatsappTemplateDeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  deleted: 5,
};

type ProviderError = {
  code?: string | number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function sanitizeWhatsappTrackingError(
  value: string | null,
): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access[_ -]?token\s*[:=]\s*\S+/gi, "access_token=[redacted]")
    .replace(/\+?\d{10,15}/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function readFailure(status: Record<string, unknown>): {
  failureCode: string | null;
  failureDetail: string | null;
} {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const error = errors.find(isRecord) as ProviderError | undefined;
  if (!error) return { failureCode: null, failureDetail: null };

  const detail = [
    error.title,
    error.message,
    error.error_data?.details,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(": ");

  return {
    failureCode:
      typeof error.code === "string" || typeof error.code === "number"
        ? String(error.code)
        : null,
    failureDetail: sanitizeWhatsappTrackingError(detail),
  };
}

export function parseWhatsappTemplateStatusEvents(
  payload: unknown,
): WhatsappTemplateStatusEventInput[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  const events = new Map<string, WhatsappTemplateStatusEventInput>();

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const statuses = Array.isArray(change.value.statuses)
        ? change.value.statuses
        : [];
      for (const rawStatus of statuses) {
        if (!isRecord(rawStatus)) continue;
        const providerMessageId = rawStatus.id;
        const status = rawStatus.status;
        const timestamp = rawStatus.timestamp;
        if (
          typeof providerMessageId !== "string" ||
          !providerMessageId ||
          typeof status !== "string" ||
          !PROVIDER_STATUSES.has(
            status as Exclude<WhatsappTemplateDeliveryStatus, "queued">,
          ) ||
          (typeof timestamp !== "string" && typeof timestamp !== "number")
        ) {
          continue;
        }

        const unixSeconds = Number(timestamp);
        if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) continue;
        const providerStatusAt = new Date(unixSeconds * 1000);
        if (Number.isNaN(providerStatusAt.getTime())) continue;

        const { failureCode, failureDetail } = readFailure(rawStatus);
        const eventKey = [
          providerMessageId,
          status,
          String(timestamp),
          failureCode ?? "",
        ].join(":");
        events.set(eventKey, {
          eventKey,
          providerMessageId,
          status: status as Exclude<WhatsappTemplateDeliveryStatus, "queued">,
          providerStatusAt,
          failureCode,
          failureDetail,
        });
      }
    }
  }

  return [...events.values()];
}

function earlierDate(current: Date | null, next: Date): Date {
  return !current || next < current ? next : current;
}

function shouldAdvanceStatus(
  current: WhatsappTemplateDeliveryState,
  event: WhatsappTemplateStatusEventInput,
): boolean {
  if (!current.currentStatusAt) return true;
  if (event.providerStatusAt > current.currentStatusAt) return true;
  if (event.providerStatusAt < current.currentStatusAt) return false;
  return STATUS_PRECEDENCE[event.status] > STATUS_PRECEDENCE[current.currentStatus];
}

export function deriveWhatsappTemplateDeliveryState(
  current: WhatsappTemplateDeliveryState,
  events: WhatsappTemplateStatusEventInput[],
): WhatsappTemplateDeliveryState {
  const next = { ...current };

  for (const event of events) {
    if (event.status === "sent") {
      next.acceptedAt = earlierDate(next.acceptedAt, event.providerStatusAt);
    } else if (event.status === "delivered") {
      next.deliveredAt = earlierDate(next.deliveredAt, event.providerStatusAt);
    } else if (event.status === "read") {
      next.readAt = earlierDate(next.readAt, event.providerStatusAt);
    } else if (event.status === "failed") {
      next.failedAt = earlierDate(next.failedAt, event.providerStatusAt);
    } else if (event.status === "deleted") {
      next.deletedAt = earlierDate(next.deletedAt, event.providerStatusAt);
    }

    if (!shouldAdvanceStatus(next, event)) continue;
    next.currentStatus = event.status;
    next.currentStatusAt = event.providerStatusAt;
    next.failureCode = event.status === "failed" ? event.failureCode : null;
    next.failureDetail = event.status === "failed" ? event.failureDetail : null;
  }

  return next;
}
