import { NextResponse } from "next/server";
import { canAccessFinance } from "@/lib/auth/finance-access";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { resolveDashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import { backfillFinanceAutomatizePaymentSettlements } from "@/lib/backoffice/payment-settlement-backfill";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("finance:view");
  if (!authz.ok) return authz.response;
  if (!canAccessFinance(authz.actor.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const window = resolveDashboardDateWindow({
    range: searchParams.get("range") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  try {
    const result = await backfillFinanceAutomatizePaymentSettlements(window);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao buscar taxas no gateway.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
