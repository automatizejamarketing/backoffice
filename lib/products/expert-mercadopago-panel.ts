import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  mercadoPagoExpertConnection,
  mercadoPagoReceiverSwitch,
} from "@/lib/db/schema";

export function selectedMercadoPagoEnvironment() {
  return process.env.MERCADOPAGO_ENVIRONMENT === "sandbox"
    ? ("sandbox" as const)
    : ("production" as const);
}

/** Operational read model: deliberately excludes every OAuth credential. */
export async function getExpertMercadoPagoPanel(id: string) {
  const env = selectedMercadoPagoEnvironment();
  const [[connection], [switchRequest]] = await Promise.all([
    db.select({ environment: mercadoPagoExpertConnection.environment, mpUserId: mercadoPagoExpertConnection.mpUserId, pix: mercadoPagoExpertConnection.pixStatus, card: mercadoPagoExpertConnection.cardStatus, revokedAt: mercadoPagoExpertConnection.revokedAt, updatedAt: mercadoPagoExpertConnection.updatedAt, lastValidatedAt: mercadoPagoExpertConnection.lastValidatedAt, lastValidationError: mercadoPagoExpertConnection.lastValidationError }).from(mercadoPagoExpertConnection).where(and(eq(mercadoPagoExpertConnection.expertId, id), eq(mercadoPagoExpertConnection.environment, env))).limit(1),
    db.select({ state: mercadoPagoReceiverSwitch.state, nextMpUserId: mercadoPagoReceiverSwitch.nextMpUserId, authorizationReason: mercadoPagoReceiverSwitch.authorizationReason, authorizedBy: mercadoPagoReceiverSwitch.authorizedBy, updatedAt: mercadoPagoReceiverSwitch.updatedAt }).from(mercadoPagoReceiverSwitch).where(and(eq(mercadoPagoReceiverSwitch.expertId, id), eq(mercadoPagoReceiverSwitch.environment, env))).limit(1),
  ]);
  return (connection ? { connected: !connection.revokedAt, environment: connection.environment, accountId: connection.mpUserId, pix: connection.pix, card: connection.card, updatedAt: connection.updatedAt, lastValidatedAt: connection.lastValidatedAt, validationError: connection.lastValidationError, switch: switchRequest ?? null } : { connected: false, environment: env, pix: "unknown", card: "unknown", lastValidatedAt: null, validationError: null, switch: switchRequest ?? null });
}
