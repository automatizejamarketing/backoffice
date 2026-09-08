import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { backofficeAuditLog, productOrder } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { formatMercadoPagoPixError } from "@/lib/mercadopago/pix-errors";
import { RECOVERY_PIX_REFUSAL_COPY } from "@/lib/products/recovery-pix-policy";
import { generateRecoveryPix } from "@/lib/products/recovery-pix-service";

/**
 * Gera o Pix de recuperação de uma venda que venceu.
 *
 * `products:manage` é a mesma permissão do estorno — as duas mexem no dinheiro
 * de um pedido de infoproduto.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;

  let result;
  try {
    result = await generateRecoveryPix({ orderId: id, adminEmail: authz.actor.email });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível gerar o Pix";
    console.error("Error creating product recovery Pix:", error);
    return NextResponse.json(
      { error: formatMercadoPagoPixError(message) },
      { status: 502 },
    );
  }

  if (!result.ok) {
    if (result.reason === "order_not_found") {
      return NextResponse.json(
        { error: "Pedido não encontrado" },
        { status: 404 },
      );
    }
    if (result.reason === "webhook_unreachable") {
      return NextResponse.json(
        {
          error:
            "O webhook do Mercado Pago não está alcançável neste ambiente, então um Pix gerado agora receberia o pagamento sem liberar o produto. Configure FRONTEND_APP_URL (ou MERCADOPAGO_WEBHOOK_URL) antes de cobrar.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: RECOVERY_PIX_REFUSAL_COPY[result.reason] },
      { status: 422 },
    );
  }

  // Só registra quando a cobrança é nova: reabrir o diálogo para copiar de novo
  // o mesmo código não é um evento de auditoria, é leitura.
  if (!result.reused) {
    const [order] = await db
      .select({ userId: productOrder.userId, status: productOrder.status })
      .from(productOrder)
      .where(eq(productOrder.id, id))
      .limit(1);

    // `target_user_id` é NOT NULL e aponta para `users`: comprador sem conta
    // (checkout público) não tem linha para referenciar. Mesmo tratamento do
    // estorno — a trilha existe para quem já é usuário.
    if (order?.userId) {
      await db.insert(backofficeAuditLog).values({
        adminEmail: authz.actor.email,
        targetUserId: order.userId,
        action: "generate_product_recovery_pix",
        fieldName: "product_order_status",
        oldValue: "failed",
        newValue: order.status,
        note: `Pedido ${id} · tentativa ${result.attempts} · ${result.amountCentavos} centavos · vence ${result.expiresAt.toISOString()}`,
      });
    }
  }

  return NextResponse.json({
    reused: result.reused,
    pix: {
      orderId: id,
      pixCopyPasteCode: result.pixCopyPasteCode,
      amountCentavos: result.amountCentavos,
      currency: result.currency,
      expiresAt: result.expiresAt.toISOString(),
      generatedAt: result.generatedAt.toISOString(),
      adminEmail: result.adminEmail,
      attempts: result.attempts,
    },
  });
}
