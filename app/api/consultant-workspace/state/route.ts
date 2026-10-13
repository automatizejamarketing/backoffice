import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { applyWorkspaceOp, readWorkspaceState, WorkspaceOpError } from "@/lib/consultant-workspace/state";
import type { WorkspaceOp } from "@/lib/consultant-workspace/types";

export const dynamic = "force-dynamic";

/** Estado do consultor (metas, linha do tempo, tags, alertas tratados) para as telas de Tráfego. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await readWorkspaceState());
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("marketing:write");
  if (!authz.ok) return authz.response;
  let op: WorkspaceOp;
  try {
    op = (await request.json()) as WorkspaceOp;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    await applyWorkspaceOp(authz.actor, op);
  } catch (error) {
    if (error instanceof WorkspaceOpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "invalid_consultant") {
      return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }
    console.error("[consultant-workspace] op failed", op.op, error);
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }
  return NextResponse.json(await readWorkspaceState());
}
