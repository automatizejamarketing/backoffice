import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

/**
 * The frontend owns the provider reconciliation pipeline. The backoffice
 * authorizes the manual operation and forwards it server-to-server, so the
 * browser never receives the cron secret or a provider credential.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const secret = process.env.FRONTEND_CRON_SECRET ?? process.env.CRON_SECRET;
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!secret) return NextResponse.json({ error: "FRONTEND_CRON_SECRET não configurado." }, { status: 500 });

  const { orderId } = await context.params;
  const target = `${frontendUrl}/api/cron-job/products/reconcile?orderId=${encodeURIComponent(orderId)}`;
  try {
    const response = await fetch(target, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ error: "Resposta inválida do frontend." }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("backoffice.products.reconciliation.proxy_failed", error);
    return NextResponse.json({ error: "Não foi possível consultar o frontend." }, { status: 502 });
  }
}
