import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { mercadoPagoExpertConnection, mercadoPagoReceiverSwitch } from "@/lib/db/schema";

function selectedEnvironment() {
  return process.env.MERCADOPAGO_ENVIRONMENT === "sandbox"
    ? ("sandbox" as const)
    : ("production" as const);
}

/** Operational read model: deliberately excludes every OAuth credential. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const [connection] = await db.select({ environment: mercadoPagoExpertConnection.environment, mpUserId: mercadoPagoExpertConnection.mpUserId, pix: mercadoPagoExpertConnection.pixStatus, card: mercadoPagoExpertConnection.cardStatus, revokedAt: mercadoPagoExpertConnection.revokedAt, updatedAt: mercadoPagoExpertConnection.updatedAt, lastValidatedAt: mercadoPagoExpertConnection.lastValidatedAt, lastValidationError: mercadoPagoExpertConnection.lastValidationError }).from(mercadoPagoExpertConnection).where(and(eq(mercadoPagoExpertConnection.expertId, id), eq(mercadoPagoExpertConnection.environment, selectedEnvironment()))).limit(1);
  return NextResponse.json(connection ? { connected: !connection.revokedAt, environment: connection.environment, accountId: connection.mpUserId, pix: connection.pix, card: connection.card, updatedAt: connection.updatedAt, lastValidatedAt: connection.lastValidatedAt, validationError: connection.lastValidationError } : { connected: false, environment: selectedEnvironment(), pix: "unknown", card: "unknown", lastValidatedAt: null, validationError: null });
}

/** Audited operator release. The Expert must still complete their own OAuth
 * callback; this endpoint can never select a recipient on their behalf. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const [connection] = await db.select().from(mercadoPagoExpertConnection).where(and(eq(mercadoPagoExpertConnection.expertId, id), eq(mercadoPagoExpertConnection.environment, selectedEnvironment()))).limit(1);
  if (!connection) return NextResponse.json({ error: "expert_connection_not_found" }, { status: 404 });
  const now = new Date();
  await db.insert(mercadoPagoReceiverSwitch).values({ expertId: id, environment: connection.environment, previousMpUserId: connection.mpUserId, authorizedBy: authz.actor.email, authorizedAt: now, updatedAt: now }).onConflictDoUpdate({ target: [mercadoPagoReceiverSwitch.expertId, mercadoPagoReceiverSwitch.environment], set: { previousMpUserId: connection.mpUserId, nextMpUserId: null, state: "authorized", authorizedBy: authz.actor.email, authorizedAt: now, activatedAt: null, updatedAt: now } });
  return NextResponse.json({ state: "authorized" });
}
