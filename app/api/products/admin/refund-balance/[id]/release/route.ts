import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { backofficeAuditLog, productPayment, productOrder, productRefundBalanceCase } from "@/lib/db/schema";
import { releaseExpertSalesAfterRefundBalanceResolution } from "@/lib/products/mercadopago-refund-service";

const requestSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe um motivo entre 1 e 500 caracteres." }, { status: 400 });
  const { id } = await params;
  try {
    const released = await releaseExpertSalesAfterRefundBalanceResolution({
      caseId: id,
      operatorEmail: authz.actor.email,
      reason: parsed.data.reason,
    });
    const [target] = await db
      .select({ userId: productOrder.userId, orderId: productPayment.orderId })
      .from(productRefundBalanceCase)
      .innerJoin(productPayment, eq(productPayment.id, productRefundBalanceCase.paymentId))
      .innerJoin(productOrder, eq(productOrder.id, productPayment.orderId))
      .where(eq(productRefundBalanceCase.id, id))
      .limit(1);
    if (target?.userId) {
      await db.insert(backofficeAuditLog).values({
        adminEmail: authz.actor.email,
        targetUserId: target.userId,
        action: "release_product_refund_balance",
        fieldName: "product_refund_balance_case",
        oldValue: "pending",
        newValue: "resolved",
        note: `Caso ${id} · pedido ${target.orderId} · motivo: ${parsed.data.reason}`,
      });
    }
    return NextResponse.json(released);
  } catch (error) {
    const message = error instanceof Error ? error.message : "refund_balance_release_failed";
    const status = message === "refund_balance_case_not_found" ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
