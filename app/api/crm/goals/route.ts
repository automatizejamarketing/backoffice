import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { canManageCrmGoals } from "@/lib/auth/rbac-core";
import {
  canEditCrmGoalMonth,
  crmMonthOf,
  isCrmMetric,
  isCrmMonth,
  parseCrmGoalTarget,
  type CrmMetric,
} from "@/lib/backoffice/crm-goals";
import { getCrmGoalsDashboard, saveCrmGoals } from "@/lib/db/crm-goals-queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;

  const monthParam = new URL(request.url).searchParams.get("month");
  const month = isCrmMonth(monthParam) ? monthParam : crmMonthOf(new Date());
  const dashboard = await getCrmGoalsDashboard(month);
  return NextResponse.json({
    ...dashboard,
    canEdit: canManageCrmGoals(authz.actor) && canEditCrmGoalMonth(month),
  });
}

export async function PUT(request: Request) {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;
  if (!canManageCrmGoals(authz.actor)) {
    return NextResponse.json(
      { error: "Só o gestor comercial ou um admin edita metas." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    month?: unknown;
    targets?: unknown;
  } | null;
  if (!body || !isCrmMonth(body.month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }
  if (!canEditCrmGoalMonth(body.month)) {
    return NextResponse.json(
      { error: "Mês fechado não muda de meta." },
      { status: 400 },
    );
  }
  if (!body.targets || typeof body.targets !== "object") {
    return NextResponse.json({ error: "Metas inválidas." }, { status: 400 });
  }

  const targets: Partial<Record<CrmMetric, number | null>> = {};
  for (const [metric, value] of Object.entries(body.targets as Record<string, unknown>)) {
    if (!isCrmMetric(metric)) {
      return NextResponse.json({ error: `Métrica desconhecida: ${metric}` }, { status: 400 });
    }
    const target = parseCrmGoalTarget(value);
    if (target === undefined) {
      return NextResponse.json(
        { error: "Meta precisa ser um inteiro de 0 a 100, ou vazio." },
        { status: 400 },
      );
    }
    targets[metric] = target;
  }

  await saveCrmGoals({ month: body.month, targets, updatedBy: authz.actor.email });
  const dashboard = await getCrmGoalsDashboard(body.month);
  return NextResponse.json({ ...dashboard, canEdit: true });
}
