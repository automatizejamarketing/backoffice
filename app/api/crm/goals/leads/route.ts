import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { crmMonthOf, isCrmMetric, isCrmMonth } from "@/lib/backoffice/crm-goals";
import { getCrmGoalMetricLeads } from "@/lib/db/crm-goals-queries";

export const dynamic = "force-dynamic";

/** Leads por trás do "X de Y" de uma métrica do mês. */
export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;

  const params = new URL(request.url).searchParams;
  const monthParam = params.get("month");
  const metric = params.get("metric");
  if (!isCrmMetric(metric)) {
    return NextResponse.json({ error: "Métrica inválida." }, { status: 400 });
  }
  const month = isCrmMonth(monthParam) ? monthParam : crmMonthOf(new Date());
  return NextResponse.json(await getCrmGoalMetricLeads(month, metric));
}
