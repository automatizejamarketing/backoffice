import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

/** Authorized operator boundary for closing an attempt only after a provider
 * no-payment fact has been recorded. The frontend owns the shared state write. */
export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
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
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
    providerFact?: unknown;
  } | null;
  if (
    !body ||
    typeof body.reason !== "string" ||
    !body.providerFact ||
    typeof body.providerFact !== "object" ||
    Array.isArray(body.providerFact)
  ) {
    return NextResponse.json(
      { error: "attempt_resolution_input_invalid" },
      { status: 400 },
    );
  }

  const { attemptId } = await context.params;
  try {
    const response = await fetch(
      `${frontendUrl}/api/cron-job/products/reconcile/attempts/${encodeURIComponent(attemptId)}/resolve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operatorEmail: authz.actor.email,
          reason: body.reason,
          providerFact: body.providerFact,
        }),
        cache: "no-store",
      },
    );
    const payload = await response.json().catch(() => ({ error: "Resposta inválida do frontend." }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("backoffice.products.payment_attempt_resolution.proxy_failed", error);
    return NextResponse.json(
      { error: "Não foi possível consultar o frontend." },
      { status: 502 },
    );
  }
}
