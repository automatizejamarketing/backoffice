import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

/**
 * Reprocessa um pagamento retido depois que a causa foi corrigida. O frontend
 * é dono da conciliação: relê o pagamento no Mercado Pago e reaplica a mesma
 * regra do webhook. O backoffice só autoriza e encaminha servidor a servidor,
 * então o navegador nunca vê o segredo.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const secret = process.env.FRONTEND_CRON_SECRET ?? process.env.CRON_SECRET;
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!secret) {
    return NextResponse.json(
      { error: "FRONTEND_CRON_SECRET não configurado." },
      { status: 500 },
    );
  }

  const { paymentId } = await context.params;
  if (!/^\d+$/.test(paymentId)) {
    return NextResponse.json({ error: "Pagamento inválido." }, { status: 400 });
  }
  try {
    const response = await fetch(
      `${frontendUrl}/api/cron-job/products/payments/${paymentId}/reprocess`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
      },
    );
    const payload = await response
      .json()
      .catch(() => ({ error: "Resposta inválida do frontend." }));
    console.info("backoffice.products.held_payment.reprocess", {
      paymentId,
      operator: authz.actor.email,
      status: response.status,
      result: payload?.status ?? null,
    });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("backoffice.products.held_payment.reprocess_failed", error);
    return NextResponse.json(
      { error: "Não foi possível consultar o frontend." },
      { status: 502 },
    );
  }
}
