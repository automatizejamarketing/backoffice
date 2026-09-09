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
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const env = selectedEnvironment();
  const [[connection], [switchRequest]] = await Promise.all([
    db.select({ environment: mercadoPagoExpertConnection.environment, mpUserId: mercadoPagoExpertConnection.mpUserId, pix: mercadoPagoExpertConnection.pixStatus, card: mercadoPagoExpertConnection.cardStatus, revokedAt: mercadoPagoExpertConnection.revokedAt, updatedAt: mercadoPagoExpertConnection.updatedAt, lastValidatedAt: mercadoPagoExpertConnection.lastValidatedAt, lastValidationError: mercadoPagoExpertConnection.lastValidationError }).from(mercadoPagoExpertConnection).where(and(eq(mercadoPagoExpertConnection.expertId, id), eq(mercadoPagoExpertConnection.environment, env))).limit(1),
    db.select({ state: mercadoPagoReceiverSwitch.state, nextMpUserId: mercadoPagoReceiverSwitch.nextMpUserId, authorizationReason: mercadoPagoReceiverSwitch.authorizationReason, authorizedBy: mercadoPagoReceiverSwitch.authorizedBy, updatedAt: mercadoPagoReceiverSwitch.updatedAt }).from(mercadoPagoReceiverSwitch).where(and(eq(mercadoPagoReceiverSwitch.expertId, id), eq(mercadoPagoReceiverSwitch.environment, env))).limit(1),
  ]);
  return NextResponse.json(connection ? { connected: !connection.revokedAt, environment: connection.environment, accountId: connection.mpUserId, pix: connection.pix, card: connection.card, updatedAt: connection.updatedAt, lastValidatedAt: connection.lastValidatedAt, validationError: connection.lastValidationError, switch: switchRequest ?? null } : { connected: false, environment: env, pix: "unknown", card: "unknown", lastValidatedAt: null, validationError: null, switch: switchRequest ?? null });
}

/** Audited operator release. The Expert must still complete their own OAuth
 * callback; this endpoint can never select a recipient on their behalf. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    reason?: string;
    environment?: string;
  };
  const reason = body.reason?.trim() ?? "";
  if (!reason) return NextResponse.json({ error: "receiver_switch_reason_required" }, { status: 422 });
  if (reason.length > 500) return NextResponse.json({ error: "receiver_switch_reason_too_long" }, { status: 422 });
  const env = selectedEnvironment();
  if (body.environment && body.environment !== env) {
    return NextResponse.json({ error: "receiver_switch_environment_mismatch" }, { status: 422 });
  }
  const [connection] = await db.select().from(mercadoPagoExpertConnection).where(and(eq(mercadoPagoExpertConnection.expertId, id), eq(mercadoPagoExpertConnection.environment, env))).limit(1);
  if (!connection) return NextResponse.json({ error: "expert_connection_not_found" }, { status: 404 });
  const [existing] = await db.select().from(mercadoPagoReceiverSwitch).where(and(eq(mercadoPagoReceiverSwitch.expertId, id), eq(mercadoPagoReceiverSwitch.environment, env))).limit(1);
  const preservesCandidate = Boolean(existing?.previousMpUserId === connection.mpUserId && existing.candidateAccessTokenEncrypted && existing.nextMpUserId);
  const now = new Date();
  const nextState = preservesCandidate ? "resolving" : "authorized";
  await db.insert(mercadoPagoReceiverSwitch).values({ expertId: id, environment: env, previousMpUserId: connection.mpUserId, nextMpUserId: preservesCandidate ? existing!.nextMpUserId : null, state: nextState, authorizedBy: authz.actor.email, authorizationReason: reason, authorizedAt: now, candidateAccessTokenEncrypted: preservesCandidate ? existing!.candidateAccessTokenEncrypted : null, candidateRefreshTokenEncrypted: preservesCandidate ? existing!.candidateRefreshTokenEncrypted : null, candidateTokenExpiresAt: preservesCandidate ? existing!.candidateTokenExpiresAt : null, candidateScopes: preservesCandidate ? existing!.candidateScopes : null, candidatePixStatus: preservesCandidate ? existing!.candidatePixStatus : null, candidateCardStatus: preservesCandidate ? existing!.candidateCardStatus : null, candidateLastValidatedAt: preservesCandidate ? existing!.candidateLastValidatedAt : null, candidateLastValidationError: preservesCandidate ? existing!.candidateLastValidationError : null, updatedAt: now }).onConflictDoUpdate({ target: [mercadoPagoReceiverSwitch.expertId, mercadoPagoReceiverSwitch.environment], set: { previousMpUserId: connection.mpUserId, nextMpUserId: preservesCandidate ? existing!.nextMpUserId : null, state: nextState, authorizedBy: authz.actor.email, authorizationReason: reason, authorizedAt: now, candidateAccessTokenEncrypted: preservesCandidate ? existing!.candidateAccessTokenEncrypted : null, candidateRefreshTokenEncrypted: preservesCandidate ? existing!.candidateRefreshTokenEncrypted : null, candidateTokenExpiresAt: preservesCandidate ? existing!.candidateTokenExpiresAt : null, candidateScopes: preservesCandidate ? existing!.candidateScopes : null, candidatePixStatus: preservesCandidate ? existing!.candidatePixStatus : null, candidateCardStatus: preservesCandidate ? existing!.candidateCardStatus : null, candidateLastValidatedAt: preservesCandidate ? existing!.candidateLastValidatedAt : null, candidateLastValidationError: preservesCandidate ? existing!.candidateLastValidationError : null, activatedAt: null, updatedAt: now } });
  return NextResponse.json({ state: nextState, environment: env });
}
