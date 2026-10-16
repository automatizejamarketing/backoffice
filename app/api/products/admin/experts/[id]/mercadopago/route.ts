import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getExpertMercadoPagoPanel,
  selectedMercadoPagoEnvironment,
} from "@/lib/products/expert-mercadopago-panel";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { mercadoPagoExpertConnection, mercadoPagoReceiverSwitch } from "@/lib/db/schema";

/** Operational read model: deliberately excludes every OAuth credential. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  return NextResponse.json(await getExpertMercadoPagoPanel(id));
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
  const env = selectedMercadoPagoEnvironment();
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
