import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  isCrmAccountStage,
  isCrmCommercialStatus,
  parseCrmDateRange,
} from "@/lib/backoffice/crm";
import { listCrmKanban, listCrmLeads } from "@/lib/db/crm-queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const params = new URL(request.url).searchParams;
  const search = params.get("q") ?? undefined;
  const stageParam = params.get("accountStage");
  const accountStage = isCrmAccountStage(stageParam) ? stageParam : undefined;
  const signup = parseCrmDateRange(params.get("signupFrom"), params.get("signupTo"));
  const expires = parseCrmDateRange(params.get("expiresFrom"), params.get("expiresTo"));

  if (params.get("view") === "kanban") {
    const columns = await listCrmKanban({ search, accountStage, signup, expires });
    return NextResponse.json({ columns });
  }

  const statusParam = params.get("commercialStatus");
  const result = await listCrmLeads({
    search,
    accountStage,
    signup,
    expires,
    commercialStatus: isCrmCommercialStatus(statusParam) ? statusParam : undefined,
    page: Number(params.get("page") ?? 1) || 1,
    pageSize: Number(params.get("pageSize") ?? 25) || 25,
  });
  return NextResponse.json(result);
}
