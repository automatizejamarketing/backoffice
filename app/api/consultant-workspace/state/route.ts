import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { consultantSeesOnlyAssignedClients, type BackofficeActor } from "@/lib/auth/rbac-core";
import { isMatTemplateKey } from "@/lib/consultant-workspace/outreach-core";
import { applyWorkspaceOp, readWorkspaceState, WorkspaceOpError } from "@/lib/consultant-workspace/state";
import type { WorkspaceOp } from "@/lib/consultant-workspace/types";

export const dynamic = "force-dynamic";

/** O consultor comum só recebe o estado dos clientes atribuídos a ele; os demais cargos veem a carteira toda. */
function readFor(actor: BackofficeActor) {
  return consultantSeesOnlyAssignedClients(actor.role)
    ? readWorkspaceState({ userIds: actor.assignedUserIds ?? [] })
    : readWorkspaceState();
}

/** Estado do consultor (metas, linha do tempo, tags, alertas tratados) para as telas de Tráfego. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await readFor(authz.actor));
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
  // "Mat enviou" só nasce de um envio real pela rota de outreach.
  if (op?.op === "sendMessage" && isMatTemplateKey(op.templateKey)) {
    return NextResponse.json({ error: "Mensagens da Mat são registradas pelo envio." }, { status: 400 });
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
  return NextResponse.json(await readFor(authz.actor));
}
