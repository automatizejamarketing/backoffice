import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { mercadoPagoExpertConnection } from "@/lib/db/schema";

/** Operational read model: deliberately excludes every OAuth credential. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const [connection] = await db.select({ environment: mercadoPagoExpertConnection.environment, mpUserId: mercadoPagoExpertConnection.mpUserId, pix: mercadoPagoExpertConnection.pixStatus, card: mercadoPagoExpertConnection.cardStatus, revokedAt: mercadoPagoExpertConnection.revokedAt, updatedAt: mercadoPagoExpertConnection.updatedAt }).from(mercadoPagoExpertConnection).where(eq(mercadoPagoExpertConnection.expertId, id)).limit(1);
  return NextResponse.json(connection ? { connected: !connection.revokedAt, environment: connection.environment, accountId: connection.mpUserId, pix: connection.pix, card: connection.card, updatedAt: connection.updatedAt } : { connected: false, pix: "unknown", card: "unknown" });
}
