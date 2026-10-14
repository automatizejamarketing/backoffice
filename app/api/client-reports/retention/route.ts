import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { queryReportRetentionCohort } from "@/lib/client-reports/retention";

export async function GET() {
  // Números da base inteira: só quem vê as regras de negócio (a tela que consome).
  const authz = await requireBackofficePermissionResponse("business:manage");
  if (!authz.ok) return authz.response;

  const rows = await queryReportRetentionCohort();
  return NextResponse.json({ rows });
}
