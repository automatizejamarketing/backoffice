import { and, asc, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import {
  whatsappTemplateDelivery,
  whatsappTemplateStatusEvent,
} from "@/lib/db/schema";
import {
  deriveWhatsappTemplateDeliveryState,
  type WhatsappTemplateDeliveryState,
  type WhatsappTemplateStatusEventInput,
} from "./delivery-model";

type PostgresDatabase = ReturnType<typeof drizzle>;
type PostgresTransaction = Parameters<
  Parameters<PostgresDatabase["transaction"]>[0]
>[0];
type StatusExecutor = PostgresDatabase | PostgresTransaction;

export async function reconcileWhatsappTemplateDelivery(
  executor: StatusExecutor,
  providerMessageId: string,
): Promise<void> {
  const [delivery] = await executor
    .select()
    .from(whatsappTemplateDelivery)
    .where(eq(whatsappTemplateDelivery.providerMessageId, providerMessageId))
    .limit(1);
  if (!delivery) return;

  const events = await executor
    .select()
    .from(whatsappTemplateStatusEvent)
    .where(
      eq(whatsappTemplateStatusEvent.providerMessageId, providerMessageId),
    )
    .orderBy(asc(whatsappTemplateStatusEvent.providerStatusAt));

  const current: WhatsappTemplateDeliveryState = {
    currentStatus: delivery.currentStatus,
    currentStatusAt: delivery.currentStatusAt,
    acceptedAt: delivery.acceptedAt,
    deliveredAt: delivery.deliveredAt,
    readAt: delivery.readAt,
    failedAt: delivery.failedAt,
    deletedAt: delivery.deletedAt,
    failureCode: delivery.failureCode,
    failureDetail: delivery.failureDetail,
  };
  const next = deriveWhatsappTemplateDeliveryState(
    current,
    events.map((event) => ({
      eventKey: event.eventKey,
      providerMessageId: event.providerMessageId,
      status: event.providerStatus,
      providerStatusAt: event.providerStatusAt,
      failureCode: event.failureCode,
      failureDetail: event.failureDetail,
    })),
  );

  await executor
    .update(whatsappTemplateStatusEvent)
    .set({ deliveryId: delivery.id })
    .where(
      and(
        eq(whatsappTemplateStatusEvent.providerMessageId, providerMessageId),
        isNull(whatsappTemplateStatusEvent.deliveryId),
      ),
    );
  await executor
    .update(whatsappTemplateDelivery)
    .set({
      ...next,
      updatedAt: new Date(),
    })
    .where(eq(whatsappTemplateDelivery.id, delivery.id));
}

export async function persistWhatsappTemplateStatusEventsWithDb(
  database: PostgresDatabase,
  events: WhatsappTemplateStatusEventInput[],
): Promise<void> {
  if (events.length === 0) return;

  await database.transaction(async (tx) => {
    for (const event of events) {
      await tx
        .insert(whatsappTemplateStatusEvent)
        .values({
          eventKey: event.eventKey,
          providerMessageId: event.providerMessageId,
          providerStatus: event.status,
          providerStatusAt: event.providerStatusAt,
          failureCode: event.failureCode,
          failureDetail: event.failureDetail,
        })
        .onConflictDoNothing();
    }

    const providerMessageIds = [
      ...new Set(events.map((event) => event.providerMessageId)),
    ];
    for (const providerMessageId of providerMessageIds) {
      await reconcileWhatsappTemplateDelivery(tx, providerMessageId);
    }
  });
}
